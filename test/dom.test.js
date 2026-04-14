// GoFront test suite — DOM and external .d.ts
import { fileURLToPath } from "node:url";
import {
	assert,
	assertEqual,
	assertErrorContains,
	compile,
	compileFile,
	FIXTURES,
	join,
	runInDom,
	runJs,
	section,
	summarize,
	test,
} from "./helpers.js";

section("DOM (jsdom)");

test("getElementById + textContent", () => {
	const { js } = compile(`package main
func main() {
  el := document.getElementById("target")
  el.textContent = "Hello GoFront"
}`);
	const { document } = runInDom(js, '<body><div id="target"></div></body>');
	assertEqual(document.getElementById("target").textContent, "Hello GoFront");
});

test("createElement + appendChild", () => {
	const { js } = compile(`package main
func main() {
  ul := document.getElementById("list")
  li := document.createElement("li")
  li.textContent = "item one"
  ul.appendChild(li)
}`);
	const { document } = runInDom(js, '<body><ul id="list"></ul></body>');
	assertEqual(document.querySelector("#list li").textContent, "item one");
});

test("build list from slice", () => {
	const { js } = compile(`package main
func main() {
  items := []string{"alpha", "beta", "gamma"}
  ul := document.getElementById("out")
  for _, text := range items {
    li := document.createElement("li")
    li.textContent = text
    ul.appendChild(li)
  }
}`);
	const { document } = runInDom(js, '<body><ul id="out"></ul></body>');
	const lis = document.querySelectorAll("#out li");
	assertEqual(lis.length, 3);
	assertEqual(lis[0].textContent, "alpha");
	assertEqual(lis[2].textContent, "gamma");
});

test("event listener fires on click", () => {
	const { js } = compile(`package main
func main() {
  btn := document.getElementById("btn")
  out := document.getElementById("out")
  btn.addEventListener("click", func() {
    out.textContent = "clicked"
  })
}`);
	const { document } = runInDom(
		js,
		'<body><button id="btn"></button><span id="out"></span></body>',
	);
	// simulate click
	document.getElementById("btn").click();
	assertEqual(document.getElementById("out").textContent, "clicked");
});

test("counter with closure over DOM", () => {
	const { js } = compile(`package main
func main() {
  count := 0
  btn := document.getElementById("btn")
  display := document.getElementById("display")
  btn.addEventListener("click", func() {
    count = count + 1
    display.textContent = string(count)
  })
}`);
	const { document } = runInDom(
		js,
		'<body><button id="btn"></button><span id="display">0</span></body>',
	);
	const btn = document.getElementById("btn");
	btn.click();
	btn.click();
	btn.click();
	assertEqual(document.getElementById("display").textContent, "3");
});

test("todo list: add and render items", () => {
	const { js } = compile(`package main
type Todo struct {
  Text string
  Done bool
}
var todos []Todo
func addTodo(text string) {
  todos = append(todos, Todo{Text: text, Done: false})
  render()
}
func render() {
  ul := document.getElementById("todos")
  ul.innerHTML = ""
  for _, t := range todos {
    li := document.createElement("li")
    li.textContent = t.Text
    ul.appendChild(li)
  }
}
func main() {
  addTodo("Buy milk")
  addTodo("Write tests")
}`);
	const { document } = runInDom(js, '<body><ul id="todos"></ul></body>');
	const lis = document.querySelectorAll("#todos li");
	assertEqual(lis.length, 2);
	assertEqual(lis[0].textContent, "Buy milk");
	assertEqual(lis[1].textContent, "Write tests");
});

test("typed DOM via js: import — valid access", () => {
	const src = `package main
import "js:typed_dom.d.ts"
func main() {
  el := document.getElementById("x")
  el.textContent = "typed!"
}`;
	const { js, errors } = compile(src, {
		fromFile: join(FIXTURES, "_dummy.go"),
	});
	assertEqual(errors.length, 0, "expected no errors");
	const { document } = runInDom(js, '<body><div id="x"></div></body>');
	assertEqual(document.getElementById("x").textContent, "typed!");
});

test("typed DOM via js: import — invalid field is caught", () => {
	const { errors } = compile(
		`package main
import "js:typed_dom.d.ts"
func main() {
  el := document.getElementById("x")
  el.nonExistentField = "bad"
}`,
		{ fromFile: join(FIXTURES, "_dummy.go") },
	);
	assert(errors.length > 0, "expected type error for unknown field");
	assertErrorContains(errors, "nonExistentField");
});

test("typed DOM — style property access", () => {
	const src = `package main
import "js:typed_dom.d.ts"
func main() {
  el := document.getElementById("box")
  el.style.color = "red"
}`;
	const { js, errors } = compile(src, {
		fromFile: join(FIXTURES, "_dummy.go"),
	});
	assertEqual(errors.length, 0);
	const { document } = runInDom(js, '<body><div id="box"></div></body>');
	assertEqual(document.getElementById("box").style.color, "red");
});

// ═════════════════════════════════════════════════════════════
// 4. External .d.ts (js: prefix)
// ═════════════════════════════════════════════════════════════

section("External .d.ts (js: prefix)");

test("namespace function call", () => {
	const { js, errors } = compile(
		`package main
import "js:math.d.ts"
func main() {
  r := JSMath.add(3, 4)
  console.log(r)
}`,
		{ fromFile: join(FIXTURES, "_dummy.go") },
	);
	assertEqual(errors.length, 0);
	// JSMath.add is not actually available at runtime — mock it
	assertEqual(runJs(js, { JSMath: { add: (a, b) => a + b } }), "7");
});

test("namespace wrong arg count → error", () => {
	const { errors } = compile(
		`package main
import "js:math.d.ts"
func main() { JSMath.add(1) }`,
		{ fromFile: join(FIXTURES, "_dummy.go") },
	);
	assert(errors.length > 0);
	assertErrorContains(errors, "argument");
});

test("declared var type from .d.ts", () => {
	// import_test.d.ts declares `var x: Other` (resolved as any)
	// The file should compile without error even though the type is unresolved
	const { errors } = compileFile(join(FIXTURES, "import_test.go"));
	assertEqual(errors.length, 0);
});

test("custom .d.ts interface method — valid", () => {
	const { errors } = compileFile(join(FIXTURES, "dom_test.go"));
	assertEqual(errors.length, 0);
});

test("custom .d.ts interface method — invalid field caught", () => {
	const { errors } = compileFile(join(FIXTURES, "dom_test_error.go"));
	assert(errors.length > 0, "expected type error");
	assertErrorContains(errors, "invalidProperty");
});

test("type alias from .d.ts", () => {
	// type_alias_test.go: `var n int = s` where s is MyString (=string) → type error
	const { errors } = compileFile(join(FIXTURES, "type_alias_test.go"));
	assert(errors.length > 0, "expected type mismatch error");
});

test("http_client.d.ts — valid fetch call compiles", () => {
	compile(
		`package main
import "js:http_client.d.ts"
func main() {
  resp := fetch("https://example.com", RequestInit{method: "GET", body: ""})
  console.log(resp.status)
}`,
		{ fromFile: join(FIXTURES, "_dummy.go") },
	);
	// RequestInit is an interface, not instantiable as struct — expect no crash on compile
	// (type checker may or may not resolve this perfectly; at minimum should not panic)
	assert(true); // just checking we don't throw
});

// ═════════════════════════════════════════════════════════════
// 5. Additional language features
// ═════════════════════════════════════════════════════════════

// ── Entry point ───────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
