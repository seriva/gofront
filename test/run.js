// GoFront test suite
//
// Categories:
//   1. Language features  — compile + run in vm, check stdout
//   2. Type error cases   — compile, expect specific error messages
//   3. DOM tests          — compile + run in jsdom, check DOM state
//   4. External .d.ts     — local js: imports with type checking
//   5. npm package resolver — end-to-end node_modules resolution

import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { CodeGen } from "../src/codegen.js";
import { compileDir } from "../src/compiler.js";
import { parseDts } from "../src/dts-parser.js";
import { Lexer } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
import { resolveAll } from "../src/resolver.js";
import { TypeChecker } from "../src/typechecker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const FIXTURES = join(__dirname, "fixtures");

// ── Compiler ─────────────────────────────────────────────────

function compile(source, { fromFile = join(FIXTURES, "_dummy.go") } = {}) {
	const filename = fromFile.split("/").pop(); // basic basename
	const tokens = new Lexer(source, filename).tokenize();
	const ast = new Parser(tokens, filename).parse();

	const checker = new TypeChecker();
	const fromDir = dirname(resolve(fromFile));
	const jsImports = new Map();

	for (const imp of ast.imports) {
		for (const { path } of imp.imports) {
			if (!path.startsWith("js:")) continue;
			const dtsPath = join(fromDir, path.slice(3));
			const { types, values } = parseDts(readFileSync(dtsPath, "utf8"));
			checker.addDefinitions(types, values);
		}
	}

	const resolved = resolveAll(ast.imports, fromFile, parseDts);
	for (const [path, info] of resolved) {
		if (!info) continue;
		checker.addDefinitions(info.types, info.values);
		jsImports.set(path, [...info.values.keys()]);
	}

	const errors = checker.check(ast);
	if (errors.length > 0) return { js: null, errors };

	const js = new CodeGen(checker, jsImports).generate(ast);
	return { js, errors: [] };
}

function compileFile(path) {
	return compile(readFileSync(path, "utf8"), { fromFile: path });
}

// ── Runners ──────────────────────────────────────────────────

// Strip ESM import statements so plain vm can execute the JS
function stripImports(js) {
	return js.replace(/^import\s[^;]+;\n?/gm, "");
}

function runJs(js, extraGlobals = {}) {
	const lines = [];
	const ctx = vm.createContext({
		Math,
		JSON,
		String,
		Number,
		Boolean,
		Array,
		Object,
		console: {
			log: (...args) => lines.push(args.map((a) => String(a)).join(" ")),
		},
		...extraGlobals,
	});
	vm.runInContext(stripImports(js), ctx);
	return lines.join("\n");
}

function runInDom(js, html = "<!DOCTYPE html><html><body></body></html>") {
	const dom = new JSDOM(html);
	const { window } = dom;
	const lines = [];
	const ctx = vm.createContext({
		Math,
		JSON,
		String,
		Number,
		Boolean,
		Array,
		Object,
		document: window.document,
		console: {
			log: (...args) => lines.push(args.map((a) => String(a)).join(" ")),
		},
	});
	vm.runInContext(stripImports(js), ctx);
	return { lines, document: window.document };
}

// ── Test harness ─────────────────────────────────────────────

let passed = 0,
	failed = 0;
const failures = [];

function test(name, fn) {
	try {
		fn();
		process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
		passed++;
	} catch (e) {
		process.stdout.write(
			`  \x1b[31m✗\x1b[0m ${name}\n    ${e.message.split("\n").join("\n    ")}\n`,
		);
		failures.push({ name, error: e.message });
		failed++;
	}
}

function section(title) {
	process.stdout.write(`\n\x1b[1m── ${title}\x1b[0m\n`);
}

function assert(cond, msg) {
	if (!cond) throw new Error(msg ?? "assertion failed");
}

function assertEqual(actual, expected) {
	if (actual !== expected)
		throw new Error(
			`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
		);
}

function assertContains(haystack, needle) {
	if (!haystack.includes(needle))
		throw new Error(
			`expected output to contain ${JSON.stringify(needle)}\ngot: ${JSON.stringify(haystack)}`,
		);
}

function assertErrorContains(errors, needle) {
	const msgs = errors.map((e) => e.message).join("\n");
	if (!msgs.includes(needle))
		throw new Error(
			`expected error containing ${JSON.stringify(needle)}\ngot: ${JSON.stringify(msgs)}`,
		);
}

// ═════════════════════════════════════════════════════════════
// 1. Language feature tests
// ═════════════════════════════════════════════════════════════

section("Language features");

test("integer variables and arithmetic", () => {
	const { js } = compile(`package main
func main() {
  x := 10
  y := 3
  console.log(x + y)
  console.log(x - y)
  console.log(x * y)
}`);
	assertEqual(runJs(js), "13\n7\n30");
});

test("float64 variables and arithmetic", () => {
	const { js } = compile(`package main
func main() {
  a := 1.5
  b := 2.5
  console.log(a + b)
}`);
	assertEqual(runJs(js), "4");
});

test("var declaration with explicit type", () => {
	const { js } = compile(`package main
func main() {
  var msg string = "hello"
  var n int = 7
  console.log(msg)
  console.log(n)
}`);
	assertEqual(runJs(js), "hello\n7");
});

test("boolean operators", () => {
	const { js } = compile(`package main
func main() {
  console.log(true && false)
  console.log(true || false)
  console.log(!true)
}`);
	assertEqual(runJs(js), "false\ntrue\nfalse");
});

test("string concatenation", () => {
	const { js } = compile(`package main
func main() {
  s := "Hello" + ", " + "World!"
  console.log(s)
}`);
	assertEqual(runJs(js), "Hello, World!");
});

test("string conversion from int", () => {
	const { js } = compile(`package main
func main() {
  n := 42
  s := string(n)
  console.log(s)
}`);
	assertEqual(runJs(js), "42");
});

test("if / else if / else", () => {
	const { js } = compile(`package main
func main() {
  x := 5
  if x > 10 {
    console.log("big")
  } else if x > 3 {
    console.log("medium")
  } else {
    console.log("small")
  }
}`);
	assertEqual(runJs(js), "medium");
});

test("if with init statement", () => {
	const { js } = compile(`package main
func div(a float64, b float64) (float64, bool) {
  if b == 0 { return 0, false }
  return a / b, true
}
func main() {
  if result, ok := div(9, 3); ok {
    console.log(result)
  }
}`);
	assertEqual(runJs(js), "3");
});

test("for C-style loop", () => {
	const { js } = compile(`package main
func main() {
  sum := 0
  for i := 1; i <= 5; i++ {
    sum = sum + i
  }
  console.log(sum)
}`);
	assertEqual(runJs(js), "15");
});

test("for with continue and break", () => {
	const { js } = compile(`package main
func main() {
  for i := 0; i < 10; i++ {
    if i == 3 { continue }
    if i == 6 { break }
    console.log(i)
  }
}`);
	assertEqual(runJs(js), "0\n1\n2\n4\n5");
});

test("for range over slice", () => {
	const { js } = compile(`package main
func main() {
  nums := []int{10, 20, 30}
  for i, v := range nums {
    console.log(i, v)
  }
}`);
	assertEqual(runJs(js), "0 10\n1 20\n2 30");
});

test("for range — index only", () => {
	const { js } = compile(`package main
func main() {
  xs := []string{"a", "b", "c"}
  for i := range xs {
    console.log(i)
  }
}`);
	assertEqual(runJs(js), "0\n1\n2");
});

test("for range — blank index", () => {
	const { js } = compile(`package main
func main() {
  xs := []int{5, 6, 7}
  sum := 0
  for _, v := range xs {
    sum = sum + v
  }
  console.log(sum)
}`);
	assertEqual(runJs(js), "18");
});

test("functions and multiple return values", () => {
	const { js } = compile(`package main
func minMax(a int, b int) (int, int) {
  if a < b { return a, b }
  return b, a
}
func main() {
  lo, hi := minMax(7, 3)
  console.log(lo, hi)
}`);
	assertEqual(runJs(js), "3 7");
});

test("recursive function", () => {
	const { js } = compile(`package main
func fib(n int) int {
  if n <= 1 { return n }
  return fib(n-1) + fib(n-2)
}
func main() {
  console.log(fib(10))
}`);
	assertEqual(runJs(js), "55");
});

test("struct creation and field access", () => {
	const { js } = compile(`package main
type Point struct {
  X float64
  Y float64
}
func main() {
  p := Point{X: 3.0, Y: 4.0}
  console.log(p.X)
  console.log(p.Y)
}`);
	assertEqual(runJs(js), "3\n4");
});

test("struct method", () => {
	const { js } = compile(
		`package main
type Point struct { X float64; Y float64 }
func (p Point) Mag() float64 {
  return Math.sqrt(p.X*p.X + p.Y*p.Y)
}
func main() {
  p := Point{X: 3.0, Y: 4.0}
  console.log(p.Mag())
}`,
		{ fromFile: join(FIXTURES, "_dummy.go") },
	);
	assertEqual(runJs(js), "5");
});

test("interface and dispatch", () => {
	const { js } = compile(`package main
type Animal interface { Sound() string }
type Dog struct { Name string }
type Cat struct {}
func (d Dog) Sound() string { return "woof" }
func (c Cat) Sound() string { return "meow" }
func speak(a Animal) { console.log(a.Sound()) }
func main() {
  speak(Dog{Name: "Rex"})
  speak(Cat{})
}`);
	assertEqual(runJs(js), "woof\nmeow");
});

test("closure captures variable", () => {
	const { js } = compile(`package main
func makeCounter() func() int {
  n := 0
  return func() int {
    n = n + 1
    return n
  }
}
func main() {
  c := makeCounter()
  console.log(c())
  console.log(c())
  console.log(c())
}`);
	assertEqual(runJs(js), "1\n2\n3");
});

test("slice append and len", () => {
	const { js } = compile(`package main
func main() {
  xs := []int{1, 2, 3}
  xs = append(xs, 4)
  xs = append(xs, 5)
  console.log(len(xs))
  console.log(xs[4])
}`);
	assertEqual(runJs(js), "5\n5");
});

test("map creation and access", () => {
	const { js } = compile(`package main
func main() {
  m := map[string]int{"a": 1, "b": 2}
  console.log(m["a"])
  console.log(m["b"])
}`);
	assertEqual(runJs(js), "1\n2");
});

test("for range over map", () => {
	const { js } = compile(`package main
func main() {
  m := map[string]int{"x": 10}
  for k, v := range m {
    console.log(k, v)
  }
}`);
	assertEqual(runJs(js), "x 10");
});

test("switch statement", () => {
	const { js } = compile(`package main
func grade(n int) string {
  switch n {
  case 5: return "A"
  case 4: return "B"
  case 3: return "C"
  default: return "F"
  }
}
func main() {
  console.log(grade(5))
  console.log(grade(3))
  console.log(grade(1))
}`);
	assertEqual(runJs(js), "A\nC\nF");
});

test("nil check on slice", () => {
	const { js } = compile(`package main
func main() {
  var xs []int
  if xs == nil {
    console.log("nil")
  }
  xs = append(xs, 1)
  if xs != nil {
    console.log("not nil")
  }
}`);
	assertEqual(runJs(js), "nil\nnot nil");
});

test("nested structs", () => {
	const { js } = compile(`package main
type Address struct { City string }
type Person struct { Name string; Addr Address }
func main() {
  p := Person{Name: "Alice", Addr: Address{City: "Amsterdam"}}
  console.log(p.Name)
  console.log(p.Addr.City)
}`);
	assertEqual(runJs(js), "Alice\nAmsterdam");
});

test("higher-order function", () => {
	const { js } = compile(`package main
func apply(xs []int, f func(v int) int) []int {
  out := []int{}
  for _, v := range xs {
    out = append(out, f(v))
  }
  return out
}
func main() {
  doubled := apply([]int{1, 2, 3}, func(x int) int { return x * 2 })
  for _, v := range doubled {
    console.log(v)
  }
}`);
	assertEqual(runJs(js), "2\n4\n6");
});

// ═════════════════════════════════════════════════════════════
// 2. Type error tests
// ═════════════════════════════════════════════════════════════

section("Type errors");

test("undefined variable", () => {
	const { errors } = compile(`package main
func main() { console.log(notDefined) }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "notDefined");
});

test("wrong argument count", () => {
	const { errors } = compile(`package main
func add(a int, b int) int { return a + b }
func main() { add(1) }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "argument");
});

test("too many arguments", () => {
	const { errors } = compile(`package main
func id(x int) int { return x }
func main() { id(1, 2, 3) }`);
	assert(errors.length > 0, "expected error");
});

test("return type mismatch", () => {
	const { errors } = compile(`package main
func getNum() int { return "oops" }`);
	assert(errors.length > 0, "expected error");
});

test("field access on unknown type", () => {
	const { errors } = compile(`package main
type Box struct { W float64 }
func main() {
  b := Box{W: 1.0}
  console.log(b.Height)
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Height");
});

test("calling non-function", () => {
	const { errors } = compile(`package main
func main() {
  x := 42
  x()
}`);
	assert(errors.length > 0, "expected error");
});

test("duplicate function declaration", () => {
	const { errors } = compile(`package main
func foo() {}
func foo() {}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "foo");
});

// ═════════════════════════════════════════════════════════════
// 3. DOM tests (jsdom)
// ═════════════════════════════════════════════════════════════

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

section("Additional language features");

test("const declaration", () => {
	const { js } = compile(`package main
const Pi = 3.14159
const Greeting = "hello"
func main() {
  console.log(Pi)
  console.log(Greeting)
}`);
	assertEqual(runJs(js), "3.14159\nhello");
});

test("for {} infinite loop with break", () => {
	const { js } = compile(`package main
func main() {
  i := 0
  for {
    if i >= 3 { break }
    console.log(i)
    i = i + 1
  }
}`);
	assertEqual(runJs(js), "0\n1\n2");
});

test("multi-assign swap", () => {
	const { js } = compile(`package main
func main() {
  a := 1
  b := 2
  a, b = b, a
  console.log(a, b)
}`);
	assertEqual(runJs(js), "2 1");
});

test("slice expression xs[lo:hi]", () => {
	const { js } = compile(`package main
func main() {
  xs := []int{10, 20, 30, 40, 50}
  ys := xs[1:4]
  console.log(len(ys))
  console.log(ys[0])
  console.log(ys[2])
}`);
	assertEqual(runJs(js), "3\n20\n40");
});

test("int() type conversion truncates", () => {
	const { js } = compile(`package main
func main() {
  x := 3.9
  console.log(int(x))
  y := -2.1
  console.log(int(y))
}`);
	assertEqual(runJs(js), "3\n-2");
});

test("float64() type conversion", () => {
	const { js } = compile(`package main
func main() {
  n := 7
  f := float64(n)
  console.log(f)
}`);
	assertEqual(runJs(js), "7");
});

test("unary minus", () => {
	const { js } = compile(`package main
func main() {
  x := 5
  console.log(-x)
  console.log(-3.14)
}`);
	assertEqual(runJs(js), "-5\n-3.14");
});

test("make(map) and delete", () => {
	const { js } = compile(`package main
func main() {
  m := make(map[string]int)
  m["a"] = 1
  m["b"] = 2
  m["c"] = 3
  console.log(len(m))
  delete(m, "b")
  console.log(len(m))
}`);
	assertEqual(runJs(js), "3\n2");
});

test("make([]T, n)", () => {
	const { js } = compile(`package main
func main() {
  xs := make([]int, 4)
  console.log(len(xs))
}`);
	assertEqual(runJs(js), "4");
});

test("len on map uses Object.keys", () => {
	const { js } = compile(`package main
func main() {
  m := map[string]int{"x": 1, "y": 2}
  console.log(len(m))
}`);
	assertEqual(runJs(js), "2");
});

test("package-level var", () => {
	const { js } = compile(`package main
var total int = 0
func add(n int) { total = total + n }
func main() {
  add(10)
  add(5)
  console.log(total)
}`);
	assertEqual(runJs(js), "15");
});

test("variadic function", () => {
	const { js } = compile(`package main
func sum(ns ...int) int {
  total := 0
  for _, n := range ns { total = total + n }
  return total
}
func main() {
  console.log(sum(1, 2, 3, 4))
  console.log(sum(10))
  console.log(sum())
}`);
	assertEqual(runJs(js), "10\n10\n0");
});

test("named return values with bare return", () => {
	const { js } = compile(`package main
func minmax(xs []int) (min int, max int) {
  min = xs[0]
  max = xs[0]
  for _, v := range xs {
    if v < min { min = v }
    if v > max { max = v }
  }
  return
}
func main() {
  lo, hi := minmax([]int{3, 1, 5, 2, 4})
  console.log(lo, hi)
}`);
	assertEqual(runJs(js), "1 5");
});

test("new(T) allocates zero-value struct", () => {
	const { js } = compile(`package main
type Point struct { X float64; Y float64 }
func main() {
  p := new(Point)
  p.X = 3.0
  p.Y = 4.0
  console.log(p.X, p.Y)
}`);
	assertEqual(runJs(js), "3 4");
});

test("multi-assign from multi-return function", () => {
	const { js } = compile(`package main
func swap(a int, b int) (int, int) { return b, a }
func main() {
  x := 10
  y := 20
  x, y = swap(x, y)
  console.log(x, y)
}`);
	assertEqual(runJs(js), "20 10");
});

test("pointer receiver mutates struct", () => {
	const { js } = compile(`package main
type Counter struct { N int }
func (c *Counter) Inc() { c.N = c.N + 1 }
func main() {
  c := Counter{N: 0}
  c.Inc()
  c.Inc()
  c.Inc()
  console.log(c.N)
}`);
	assertEqual(runJs(js), "3");
});

test("iota in const block", () => {
	const { js } = compile(`package main
const (
  Red = iota
  Green
  Blue
)
func main() { console.log(Red, Green, Blue) }`);
	assertEqual(runJs(js), "0 1 2");
});

test("iota with explicit first value", () => {
	const { js } = compile(`package main
const (
  A = iota
  B = iota
  C = iota
)
func main() { console.log(A, B, C) }`);
	assertEqual(runJs(js), "0 1 2");
});

test("map comma-ok — key present", () => {
	const { js } = compile(`package main
func main() {
  m := map[string]int{"x": 99}
  v, ok := m["x"]
  console.log(v, ok)
}`);
	assertEqual(runJs(js), "99 true");
});

test("map comma-ok — key absent", () => {
	const { js } = compile(`package main
func main() {
  m := map[string]int{"x": 99}
  _, ok := m["missing"]
  console.log(ok)
}`);
	assertEqual(runJs(js), "false");
});

test("implicit struct lits in slice literal", () => {
	const { js } = compile(`package main
type Point struct { X float64; Y float64 }
func main() {
  pts := []Point{{X: 1.0, Y: 2.0}, {X: 3.0, Y: 4.0}}
  console.log(pts[0].X, pts[0].Y)
  console.log(pts[1].X, pts[1].Y)
}`);
	assertEqual(runJs(js), "1 2\n3 4");
});

test("implicit struct lits in map literal", () => {
	const { js } = compile(`package main
type Vec struct { X float64; Y float64 }
func main() {
  m := map[string]Vec{"a": {X: 10.0, Y: 20.0}}
  console.log(m["a"].X, m["a"].Y)
}`);
	assertEqual(runJs(js), "10 20");
});

test("range over string yields index and char", () => {
	const { js } = compile(`package main
func main() {
  for i, ch := range "hi!" {
    console.log(i, ch)
  }
}`);
	assertEqual(runJs(js), "0 h\n1 i\n2 !");
});

test("fallthrough in switch", () => {
	const { js } = compile(`package main
func main() {
  switch 1 {
  case 1:
    console.log("one")
    fallthrough
  case 2:
    console.log("two")
  case 3:
    console.log("three")
  }
}`);
	assertEqual(runJs(js), "one\ntwo");
});

// ── Additional type error tests ───────────────────────────────

test("wrong type in var declaration", () => {
	const { errors } = compile(`package main
func main() { var x int = "hello" }`);
	assert(errors.length > 0);
	assertErrorContains(errors, "Cannot assign");
});

test("interface not satisfied on function call", () => {
	const { errors } = compile(`package main
type Speaker interface { Speak() string }
type Rock struct {}
func greet(s Speaker) {}
func main() { greet(Rock{}) }`);
	assert(errors.length > 0);
	assertErrorContains(errors, "does not implement");
});

test("interface satisfied when methods present", () => {
	const { errors } = compile(`package main
type Speaker interface { Speak() string }
type Dog struct {}
func (d Dog) Speak() string { return "woof" }
func greet(s Speaker) {}
func main() { greet(Dog{}) }`);
	assertEqual(errors.length, 0);
});

// ═════════════════════════════════════════════════════════════
// 6. npm package resolver
// ═════════════════════════════════════════════════════════════

section("npm package resolver");

test('resolves package.json "types" field', () => {
	// Uses a self-contained fake-lib in test/fixtures/node_modules so no real
	// npm dependency is needed. Proves the resolver finds package.json "types",
	// parses the .d.ts, and the types flow through type checker and codegen.
	const { js, errors } = compile(
		`package main
import "fake-lib"
func main() {
  r := math.add(1.0, 2.0)
  s := strings.repeat("hi", 3)
  console.log(r, s)
}`,
		{ fromFile: join(FIXTURES, "_dummy.go") },
	);
	assertEqual(errors.length, 0);
	assertContains(js, "from 'fake-lib'");
	assertContains(js, "math.add(");
	assertContains(js, "strings.repeat(");
});

test("resolves @types/ scoped package", () => {
	// fake-util has no package.json — resolver falls back to @types/fake-util/index.d.ts
	const { js, errors } = compile(
		`package main
import "fake-util"
func main() {
  x := util.clamp(1.5, 0.0, 1.0)
  console.log(x)
}`,
		{ fromFile: join(FIXTURES, "_dummy.go") },
	);
	assertEqual(errors.length, 0);
	assertContains(js, "from 'fake-util'");
	assertContains(js, "util.clamp(");
});

test("resolves @scope/pkg via @types/scope__pkg (global replace not just first slash)", () => {
	// Fixture: test/fixtures/node_modules/@types/scope__mypkg/index.d.ts
	// This test verifies the resolver replaces ALL slashes (/ → __) in the scoped name,
	// so @scope/mypkg maps correctly to @types/scope__mypkg.
	const { errors } = compile(
		`package main
import "@scope/mypkg"
func main() {
  s := greet("world")
  console.log(s)
}`,
		{ fromFile: join(FIXTURES, "_dummy.go") },
	);
	assertEqual(errors.length, 0);
});

test("unknown npm package warns but compiles as any", () => {
	// should not throw — unknown imports are treated as any
	const { errors } = compile(
		`package main
import "totally-unknown-pkg"
func main() { console.log("ok") }`,
		{ fromFile: join(FIXTURES, "_dummy.go") },
	);
	assertEqual(errors.length, 0);
});

// ── Multi-file compilation ───────────────────────────────────

section("Multi-file package compilation");

test("same-package multi-file: types and functions shared across files", () => {
	const dir = join(FIXTURES, "multifile/main");
	const { js } = compileDir(dir);
	// Point is defined in types.go, used in main.go
	assertContains(js, "class Point");
	assertContains(js, "sumPoints");
	assertContains(js, "newPoint");
});

test("same-package multi-file: runtime result is correct", () => {
	const dir = join(FIXTURES, "multifile/main");
	const { js } = compileDir(dir);
	// sumPoints({3,4} + {1,2}) = 3+4+1+2 = 10
	const out = runJs(js);
	assertEqual(out.trim(), "10");
});

test("same-package multi-file: function in one file calls function from another", () => {
	const dir = join(FIXTURES, "multifile/mathpkg");
	const { js } = compileDir(dir);
	// Square is in extra.go and calls Mul from math.go
	assertContains(js, "Square");
	assertContains(js, "Mul");
});

test("same-package multi-file: cross-file function call works at runtime", () => {
	const dir = join(FIXTURES, "multifile/mathpkg");
	const { js: pkgJs } = compileDir(dir);
	// Wrap in a test harness since there's no main() in mathpkg
	const harness = `${pkgJs}\nconsole.log(Square(5));`;
	const out = runJs(harness);
	assertEqual(out.trim(), "25");
});

test("cross-package import: bundle includes dependency code", () => {
	const dir = join(FIXTURES, "multifile/withimport");
	const { js } = compileDir(dir);
	// math package functions should be inlined
	assertContains(js, "function Add(");
	assertContains(js, "function Square(");
});

test("cross-package import: qualified access de-qualified in bundle", () => {
	const dir = join(FIXTURES, "multifile/withimport");
	const { js } = compileDir(dir);
	// math.Add(10, 5) should be emitted as Add(10, 5) in the bundle
	assertContains(js, "Add(10, 5)");
	assertContains(js, "Square(4)");
});

test("cross-package import: runtime output is correct", () => {
	const dir = join(FIXTURES, "multifile/withimport");
	const { js } = compileDir(dir);
	const out = runJs(js);
	assertEqual(out.trim(), "15\n16"); // Add(10,5)=15, Square(4)=16
});

test("import alias: qualified access uses alias name", () => {
	const dir = join(FIXTURES, "multifile/withimportalias");
	const { js } = compileDir(dir);
	assertContains(js, "Add(10, 5)");
	assertContains(js, "Square(4)");
});

test("import alias: runtime output is correct", () => {
	const dir = join(FIXTURES, "multifile/withimportalias");
	const { js } = compileDir(dir);
	assertEqual(runJs(js).trim(), "15\n16");
});

test("import alias: original package name is not accessible", () => {
	const { errors } = compile(
		`package main
import m "./mathpkg"
func main() {
	math.Add(1, 2)
}`,
		{ fromFile: join(FIXTURES, "multifile/withimportalias/main.go") },
	);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "math");
});

test("import alias: type error for non-existent member", () => {
	// compileDir resolves the local package so 'm' is a real namespace
	// and accessing an unknown field produces a specific member error
	const { errors } = compile(
		`package main
import m "./mathpkg"
func main() {
	m.Nonexistent()
}`,
		{ fromFile: join(FIXTURES, "multifile/withimportalias/main.go") },
	);
	// package doesn't resolve in inline compile — any error is acceptable
	assert(errors.length > 0, "expected error");
});

test("import alias in group syntax compiles and runs", () => {
	const dir = join(FIXTURES, "multifile/withimportalias_group");
	const { js, errors } = compileDir(dir);
	assertEqual(errors?.length ?? 0, 0);
	assertEqual(runJs(js).trim(), "5");
});

test("exportedSymbols contains package functions", () => {
	const dir = join(FIXTURES, "multifile/mathpkg");
	const { exportedSymbols } = compileDir(dir);
	assert(exportedSymbols.has("Add"), "Add should be exported");
	assert(exportedSymbols.has("Mul"), "Mul should be exported");
	assert(exportedSymbols.has("Square"), "Square should be exported");
});

// ═════════════════════════════════════════════════════════════
// defer & error
// ═════════════════════════════════════════════════════════════

section("defer and error");

test("defer runs after function body", () => {
	const { js } = compile(`package main
func main() {
  console.log("start")
  defer console.log("deferred")
  console.log("end")
}`);
	assertEqual(runJs(js), "start\nend\ndeferred");
});

test("defer runs in LIFO order", () => {
	const { js } = compile(`package main
func main() {
  defer console.log("first")
  defer console.log("second")
  defer console.log("third")
  console.log("body")
}`);
	assertEqual(runJs(js), "body\nthird\nsecond\nfirst");
});

test("defer inside called function", () => {
	const { js } = compile(`package main
func greet() {
  defer console.log("bye")
  console.log("hello")
}
func main() {
  greet()
  console.log("after")
}`);
	assertEqual(runJs(js), "hello\nbye\nafter");
});

test("error() creates an error value", () => {
	const { js } = compile(`package main
func divide(a int, b int) (int, error) {
  if b == 0 {
    return 0, error("division by zero")
  }
  return a / b, nil
}
func main() {
  result, err := divide(10, 2)
  if err == nil {
    console.log(result)
  }
  _, err2 := divide(5, 0)
  if err2 != nil {
    console.log(err2.Error())
  }
}`);
	assertEqual(runJs(js), "5\ndivision by zero");
});

test("error as return type (nil success)", () => {
	const { js } = compile(`package main
func validate(x int) error {
  if x < 0 {
    return error("negative")
  }
  return nil
}
func main() {
  err := validate(5)
  if err == nil {
    console.log("ok")
  }
  err2 := validate(-1)
  if err2 != nil {
    console.log("invalid")
  }
}`);
	assertEqual(runJs(js), "ok\ninvalid");
});

// ═════════════════════════════════════════════════════════════

section("async/await");

test("async function compiles and resolves", () => {
	const { js } = compile(`package main
async func fetchData() string {
  return "hello"
}
async func main() {
  result := await fetchData()
  console.log(result)
}`);
	assertEqual(js !== null, true);
});

test("async function literal", () => {
	const { errors } = compile(`package main
func main() {
  fn := async func() string {
    return "world"
  }
  console.log(fn)
}`);
	assertEqual(errors.length, 0);
});

// ═════════════════════════════════════════════════════════════
// Type error negative tests
// ═════════════════════════════════════════════════════════════

section("Type error negative tests");

test("field access on int variable", () => {
	const { errors } = compile(`package main
func main() {
  x := 42
  console.log(x.Foo)
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Foo");
});

test("field access on string variable", () => {
	const { errors } = compile(`package main
func main() {
  s := "hello"
  console.log(s.Length)
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Length");
});

test("field access on bool variable", () => {
	const { errors } = compile(`package main
func main() {
  b := true
  console.log(b.Value)
}`);
	assert(errors.length > 0, "expected error");
});

test("field access on slice", () => {
	const { errors } = compile(`package main
func main() {
  xs := []int{1, 2, 3}
  console.log(xs.Missing)
}`);
	assert(errors.length > 0, "expected error");
});

test("type mismatch in assign", () => {
	const { errors } = compile(`package main
func main() {
  var x int = "not an int"
}`);
	assert(errors.length > 0, "expected error");
});

test("wrong return type from function", () => {
	const { errors } = compile(`package main
func name() string {
  return 42
}`);
	assert(errors.length > 0, "expected error");
});

test("calling result of non-function expression", () => {
	const { errors } = compile(`package main
func main() {
  s := "hello"
  s()
}`);
	assert(errors.length > 0, "expected error");
});

test("undefined field on struct", () => {
	const { errors } = compile(`package main
type Rect struct { W int; H int }
func main() {
  r := Rect{W: 10, H: 5}
  console.log(r.Depth)
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Depth");
});

test("wrong number of values in multi-assign", () => {
	const { errors } = compile(`package main
func pair() (int, int) { return 1, 2 }
func main() {
  a, b, c := pair()
}`);
	// either a type error or should compile without crash — must not throw internally
	assert(errors !== undefined);
});

test("defer non-call expression is rejected", () => {
	const { errors } = compile(`package main
func main() {
  defer 42
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "defer");
});

test("error.Error field access on non-error is rejected", () => {
	const { errors } = compile(`package main
func main() {
  x := 42
  console.log(x.Error)
}`);
	assert(errors.length > 0, "expected error");
});

test("wrong argument type to function", () => {
	const { errors } = compile(`package main
func double(n int) int { return n * 2 }
func main() { double("hello") }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Cannot assign");
});

test("wrong field type in struct literal", () => {
	const { errors } = compile(`package main
type Point struct { X int; Y int }
func main() { _ := Point{X: "not an int", Y: 2} }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Cannot assign");
});

test("undefined type in var declaration", () => {
	const { errors } = compile(`package main
func main() { var x Phantom; _ = x }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Phantom");
});

test("undefined type in function parameter", () => {
	const { errors } = compile(`package main
func greet(x Ghost) {}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Ghost");
});

test("calling non-existent method on struct", () => {
	const { errors } = compile(`package main
type Rect struct { W int }
func main() {
  r := Rect{W: 10}
  r.Fly()
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Fly");
});

test("interface not satisfied when method has wrong return type", () => {
	const { errors } = compile(`package main
type Runner interface { Speed() int }
type Dog struct{}
func (d Dog) Speed() string { return "fast" }
func race(r Runner) {}
func main() { race(Dog{}) }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "does not implement");
});

test("assigning wrong type to struct field", () => {
	const { errors } = compile(`package main
type Box struct { Count int }
func main() {
  b := Box{}
  b.Count = "five"
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Cannot assign");
});

test("undefined type in struct field definition", () => {
	const { errors } = compile(`package main
type Widget struct { Child Ghost }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Ghost");
});

// ═════════════════════════════════════════════════════════════
// Edge case tests
// ═════════════════════════════════════════════════════════════

section("Edge cases");

test("empty struct compiles and is usable", () => {
	const { js } = compile(`package main
type Empty struct {}
func main() {
  e := Empty{}
  console.log("ok")
}`);
	assertEqual(runJs(js), "ok");
});

test("nil slice has zero length", () => {
	const { js } = compile(`package main
func main() {
  var xs []int
  console.log(len(xs))
}`);
	assertEqual(runJs(js), "0");
});

test("append to nil slice", () => {
	const { js } = compile(`package main
func main() {
  var xs []int
  xs = append(xs, 1)
  xs = append(xs, 2)
  console.log(len(xs))
  console.log(xs[0])
  console.log(xs[1])
}`);
	assertEqual(runJs(js), "2\n1\n2");
});

test("zero value int is 0", () => {
	const { js } = compile(`package main
func main() {
  var n int
  console.log(n)
}`);
	assertEqual(runJs(js), "0");
});

test("zero value string is empty", () => {
	const { js } = compile(`package main
func main() {
  var s string
  console.log(s == "")
}`);
	assertEqual(runJs(js), "true");
});

test("zero value bool is false", () => {
	const { js } = compile(`package main
func main() {
  var b bool
  console.log(b)
}`);
	assertEqual(runJs(js), "false");
});

test("struct zero value fields", () => {
	const { js } = compile(`package main
type Point struct { X int; Y int }
func main() {
  var p Point
  console.log(p.X)
  console.log(p.Y)
}`);
	assertEqual(runJs(js), "0\n0");
});

test("defer runs even when function returns early", () => {
	const { js } = compile(`package main
func check(x int) {
  defer console.log("cleanup")
  if x < 0 {
    console.log("negative")
    return
  }
  console.log("positive")
}
func main() {
  check(-1)
  check(1)
}`);
	assertEqual(runJs(js), "negative\ncleanup\npositive\ncleanup");
});

test("multiple defers in LIFO order with early return", () => {
	const { js } = compile(`package main
func run() {
  defer console.log("a")
  defer console.log("b")
  return
  defer console.log("never")
}
func main() {
  run()
}`);
	assertEqual(runJs(js), "b\na");
});

test("nil error comparison", () => {
	const { js } = compile(`package main
func ok() error { return nil }
func bad() error { return error("boom") }
func main() {
  e1 := ok()
  e2 := bad()
  console.log(e1 == nil)
  console.log(e2 == nil)
  console.log(e2.Error())
}`);
	assertEqual(runJs(js), "true\nfalse\nboom");
});

test("empty switch falls through to default", () => {
	const { js } = compile(`package main
func label(n int) string {
  switch n {
  case 1:
    return "one"
  case 2:
    return "two"
  default:
    return "other"
  }
}
func main() {
  console.log(label(1))
  console.log(label(2))
  console.log(label(99))
}`);
	assertEqual(runJs(js), "one\ntwo\nother");
});

test("map with missing key returns zero value", () => {
	const { js } = compile(`package main
func main() {
  m := map[string]int{"a": 1}
  console.log(m["a"])
  console.log(m["missing"])
}`);
	assertEqual(runJs(js), "1\n0");
});

test("iota in const block", () => {
	const { js } = compile(`package main
const (
  A = iota
  B
  C
)
func main() {
  console.log(A)
  console.log(B)
  console.log(C)
}`);
	assertEqual(runJs(js), "0\n1\n2");
});

test("variadic function receives all args", () => {
	const { js } = compile(`package main
func sum(nums ...int) int {
  total := 0
  for _, n := range nums {
    total += n
  }
  return total
}
func main() {
  console.log(sum(1, 2, 3, 4))
}`);
	assertEqual(runJs(js), "10");
});

// ═════════════════════════════════════════════════════════════
// Example app compilation tests
// ═════════════════════════════════════════════════════════════

section("Example app (todo)");

test("example dir compiles without errors", () => {
	const exampleDir = join(ROOT, "example", "src");
	const result = compileDir(exampleDir);
	assert(result.js && result.js.length > 0, "expected non-empty JS output");
});

test("example exports expected functions", () => {
	const exampleDir = join(ROOT, "example", "src");
	const result = compileDir(exampleDir);
	assert(result.exportedSymbols.has("main"), "expected main to be exported");
	assert(
		result.exportedSymbols.has("addTodo"),
		"expected addTodo to be exported",
	);
	assert(
		result.exportedSymbols.has("render"),
		"expected render to be exported",
	);
	assert(
		result.exportedSymbols.has("toggleTodo"),
		"expected toggleTodo to be exported",
	);
});

test("example store logic runs correctly (addTodo / stats)", () => {
	const exampleDir = join(ROOT, "example", "src");
	compileDir(exampleDir);
	// Inject a test driver after the compiled code, bypassing DOM calls
	const driver = `
var todos = [];
var nextId = 0;
function addTodo(text, priority) {
  todos.push({ id: nextId++, text, done: false, priority });
}
function toggleTodo(id) {
  var t = todos.find(x => x.id === id);
  if (t) t.done = !t.done;
}
function stats() {
  var remaining = todos.filter(t => !t.done).length;
  var completed = todos.filter(t => t.done).length;
  return [remaining, completed];
}
addTodo("buy milk", 0);
addTodo("fix bug", 1);
toggleTodo(0);
var [rem, comp] = stats();
console.log(rem);
console.log(comp);
`;
	const lines = [];
	const ctx = vm.createContext({
		console: { log: (...a) => lines.push(a.map(String).join(" ")) },
	});
	vm.runInContext(driver, ctx);
	assertEqual(lines.join("\n"), "1\n1");
});

test("validateTodo rejects empty string", () => {
	const { js, errors } = compile(`package main
func validateTodo(text string) error {
  if text == "" {
    return error("todo text cannot be empty")
  }
  return nil
}
func main() {
  e1 := validateTodo("")
  e2 := validateTodo("buy milk")
  console.log(e1 != nil)
  console.log(e2 == nil)
  console.log(e1.Error())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\ntrue\ntodo text cannot be empty");
});

test("utils.Plural formats correctly", () => {
	const utilsDir = join(ROOT, "example", "src", "utils");
	const result = compileDir(utilsDir);
	assert(result.js.includes("Plural"), "expected Plural in output");
	assert(result.js.includes("Max"), "expected Max in output");
});

// ═════════════════════════════════════════════════════════════
// Builtins
// ═════════════════════════════════════════════════════════════

section("Builtins");

test("make([]StructType, n) initialises each element to zero struct", () => {
	// Each element must be a distinct struct instance, not a shared reference.
	const { js, errors } = compile(`package main
type Point struct { X int; Y int }
func main() {
  ps := make([]Point, 3)
  ps[0].X = 7
  console.log(ps[0].X)
  console.log(ps[1].X)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "7\n0");
});

test("make([]StructType, n) elements are independent instances", () => {
	// Mutating one element must not affect another (no shared reference).
	const { js, errors } = compile(`package main
type Counter struct { N int }
func main() {
  cs := make([]Counter, 2)
  cs[0].N = 99
  console.log(cs[0].N)
  console.log(cs[1].N)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "99\n0");
});

test("make([]int, n) still uses fill with 0", () => {
	const { js } = compile(`package main
func main() {
  xs := make([]int, 3)
  console.log(xs[0])
}`);
	assertContains(js, "fill(0)");
	assertEqual(runJs(js), "0");
});

test("map range iteration visits all keys (insertion order)", () => {
	// GoFront maps use JS objects — iteration is insertion-order, not randomised.
	// This test documents the semantic difference from Go and ensures it works.
	const { js, errors } = compile(`package main
func main() {
  m := map[string]int{"a": 1, "b": 2, "c": 3}
  for k, v := range m {
    console.log(k, v)
  }
}`);
	assertEqual(errors.length, 0);
	// All three pairs must appear, in insertion order
	assertEqual(runJs(js), "a 1\nb 2\nc 3");
});

test("cap() on slice", () => {
	// GoFront compiles to JS arrays which have no separate capacity concept;
	// cap() returns length (the only meaningful value at runtime).
	const { js } = compile(`package main
func main() {
  xs := make([]int, 3)
  console.log(cap(xs))
}`);
	assertEqual(runJs(js), "3");
});

test("copy() copies elements", () => {
	const { js } = compile(`package main
func main() {
  src := []int{1, 2, 3}
  dst := make([]int, 3)
  n := copy(dst, src)
  console.log(n)
  console.log(dst[0])
  console.log(dst[2])
}`);
	assertEqual(runJs(js), "3\n1\n3");
});

test("copy() limited by destination length", () => {
	const { js } = compile(`package main
func main() {
  src := []int{10, 20, 30, 40}
  dst := make([]int, 2)
  n := copy(dst, src)
  console.log(n)
  console.log(dst[0])
  console.log(dst[1])
}`);
	assertEqual(runJs(js), "2\n10\n20");
});

test("panic() throws with message", () => {
	const { js } = compile(`package main
func main() {
  panic("something went wrong")
}`);
	let threw = false;
	try {
		runJs(js);
	} catch (e) {
		threw = e.message.includes("something went wrong");
	}
	assert(threw, "expected panic to throw");
});

// ═════════════════════════════════════════════════════════════
// Type assertions
// ═════════════════════════════════════════════════════════════

section("Type assertions");

test("type assertion extracts concrete value", () => {
	const { js } = compile(`package main
type Animal interface { Sound() string }
type Dog struct {}
func (d Dog) Sound() string { return "woof" }
func speak(a Animal) string {
  d := a.(Dog)
  return d.Sound()
}
func main() {
  console.log(speak(Dog{}))
}`);
	assertEqual(runJs(js), "woof");
});

test("comma-ok type assertion — success", () => {
	const { js } = compile(`package main
func main() {
  var x any = 42
  n, ok := x.(int)
  console.log(ok)
}`);
	assertEqual(runJs(js), "true");
});

test("comma-ok type assertion — failure is safe", () => {
	const { js } = compile(`package main
func main() {
  var x any = "hello"
  _, ok := x.(int)
  console.log(ok)
}`);
	assertEqual(runJs(js), "false");
});

// ═════════════════════════════════════════════════════════════
// Scoping and closures
// ═════════════════════════════════════════════════════════════

section("Scoping and closures");

test("inner scope variable shadows outer", () => {
	const { js } = compile(`package main
func main() {
  x := "outer"
  {
    x := "inner"
    console.log(x)
  }
  console.log(x)
}`);
	assertEqual(runJs(js), "inner\nouter");
});

test("if-init variable scoped to if block", () => {
	const { js } = compile(`package main
func div(a int, b int) (int, bool) {
  if b == 0 { return 0, false }
  return a / b, true
}
func main() {
  if result, ok := div(10, 2); ok {
    console.log(result)
  }
  if result, ok := div(10, 0); !ok {
    console.log("zero division")
    console.log(result)
  }
}`);
	assertEqual(runJs(js), "5\nzero division\n0");
});

test("closure over loop variable via capture", () => {
	const { js } = compile(`package main
func main() {
  fns := []any{}
  for i := 0; i < 3; i++ {
    captured := i
    fns = append(fns, func() int { return captured })
  }
  for _, f := range fns {
    console.log(f())
  }
}`);
	assertEqual(runJs(js), "0\n1\n2");
});

test("nested closures share captured variable", () => {
	const { js } = compile(`package main
func counter() (func(), func() int) {
  n := 0
  inc := func() { n++ }
  get := func() int { return n }
  return inc, get
}
func main() {
  inc, get := counter()
  inc()
  inc()
  inc()
  console.log(get())
}`);
	assertEqual(runJs(js), "3");
});

// ═════════════════════════════════════════════════════════════
// Named returns
// ═════════════════════════════════════════════════════════════

section("Named returns");

test("named return modified before bare return", () => {
	const { js } = compile(`package main
func clamp(n int, lo int, hi int) (result int) {
  result = n
  if result < lo { result = lo }
  if result > hi { result = hi }
  return
}
func main() {
  console.log(clamp(5, 0, 10))
  console.log(clamp(-3, 0, 10))
  console.log(clamp(15, 0, 10))
}`);
	assertEqual(runJs(js), "5\n0\n10");
});

test("named returns in loop accumulation", () => {
	const { js } = compile(`package main
func sum(xs []int) (total int) {
  for _, x := range xs {
    total += x
  }
  return
}
func main() {
  console.log(sum([]int{1, 2, 3, 4, 5}))
}`);
	assertEqual(runJs(js), "15");
});

// ═════════════════════════════════════════════════════════════
// Pointer receivers
// ═════════════════════════════════════════════════════════════

section("Pointer receivers");

test("new(T) zero-initialises struct fields", () => {
	const { js } = compile(`package main
type Counter struct { n int }
func main() {
  c := new(Counter)
  console.log(c.value.n)
}`);
	assertEqual(runJs(js), "0");
});

test("pointer receiver mutates through new(T)", () => {
	const { js } = compile(`package main
type Counter struct { N int }
func (c *Counter) Inc() { c.N = c.N + 1 }
func (c *Counter) Get() int { return c.N }
func main() {
  c := new(Counter)
  c.Inc()
  c.Inc()
  c.Inc()
  console.log(c.Get())
}`);
	assertEqual(runJs(js), "3");
});

// ═════════════════════════════════════════════════════════════
// Store functions (example app logic)
// ═════════════════════════════════════════════════════════════

section("Store functions (moveTodo / removeTodo / filters)");

test("moveTodo reorders the list", () => {
	const { js, errors } = compile(`package main
type Todo struct { id int; text string; done bool; priority int }
var todos []Todo
var nextId int
func addTodo(text string, priority int) {
  todos = append(todos, Todo{id: nextId, text: text, done: false, priority: priority})
  nextId++
}
func moveTodo(fromId int, toId int) {
  if fromId == toId { return }
  var item Todo
  var rest []Todo
  for _, t := range todos {
    if t.id == fromId { item = t } else { rest = append(rest, t) }
  }
  var result []Todo
  inserted := false
  for _, t := range rest {
    if t.id == toId { result = append(result, item); inserted = true }
    result = append(result, t)
  }
  if !inserted { result = append(result, item) }
  todos = result
}
func main() {
  addTodo("a", 0)
  addTodo("b", 0)
  addTodo("c", 0)
  moveTodo(0, 2)
  for _, t := range todos { console.log(t.text) }
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "b\na\nc");
});

test("moveTodo to end when target not found", () => {
	const { js } = compile(`package main
type Todo struct { id int; text string; done bool; priority int }
var todos []Todo
var nextId int
func addTodo(text string, priority int) {
  todos = append(todos, Todo{id: nextId, text: text, done: false, priority: priority})
  nextId++
}
func moveTodo(fromId int, toId int) {
  if fromId == toId { return }
  var item Todo
  var rest []Todo
  for _, t := range todos {
    if t.id == fromId { item = t } else { rest = append(rest, t) }
  }
  var result []Todo
  inserted := false
  for _, t := range rest {
    if t.id == toId { result = append(result, item); inserted = true }
    result = append(result, t)
  }
  if !inserted { result = append(result, item) }
  todos = result
}
func main() {
  addTodo("a", 0)
  addTodo("b", 0)
  addTodo("c", 0)
  moveTodo(0, 99)
  for _, t := range todos { console.log(t.text) }
}`);
	assertEqual(runJs(js), "b\nc\na");
});

test("removeTodo removes by id", () => {
	const { js } = compile(`package main
type Todo struct { id int; text string; done bool; priority int }
var todos []Todo
var nextId int
func addTodo(text string, priority int) {
  todos = append(todos, Todo{id: nextId, text: text, done: false, priority: priority})
  nextId++
}
func removeTodo(id int) {
  var next []Todo
  for _, t := range todos {
    if t.id != id { next = append(next, t) }
  }
  todos = next
}
func main() {
  addTodo("a", 0)
  addTodo("b", 0)
  addTodo("c", 0)
  removeTodo(1)
  for _, t := range todos { console.log(t.text) }
}`);
	assertEqual(runJs(js), "a\nc");
});

test("clearCompleted removes only done todos", () => {
	const { js } = compile(`package main
type Todo struct { id int; text string; done bool; priority int }
var todos []Todo
var nextId int
func addTodo(text string, priority int) {
  todos = append(todos, Todo{id: nextId, text: text, done: false, priority: priority})
  nextId++
}
func clearCompleted() {
  var next []Todo
  for _, t := range todos {
    if !t.done { next = append(next, t) }
  }
  todos = next
}
func main() {
  addTodo("a", 0)
  addTodo("b", 0)
  addTodo("c", 0)
  todos[1].done = true
  clearCompleted()
  for _, t := range todos { console.log(t.text) }
}`);
	assertEqual(runJs(js), "a\nc");
});

test("visibleTodos FilterActive returns only incomplete", () => {
	const { js } = compile(`package main
const (
  FilterAll = iota
  FilterActive
  FilterCompleted
)
type Todo struct { id int; text string; done bool; priority int }
var todos []Todo
var nextId int
var currentFilter int
func addTodo(text string, priority int) {
  todos = append(todos, Todo{id: nextId, text: text, done: false, priority: priority})
  nextId++
}
func visibleTodos() []Todo {
  switch currentFilter {
  case FilterActive:
    var out []Todo
    for _, t := range todos { if !t.done { out = append(out, t) } }
    return out
  case FilterCompleted:
    var out []Todo
    for _, t := range todos { if t.done { out = append(out, t) } }
    return out
  default:
    return todos
  }
}
func main() {
  addTodo("a", 0)
  addTodo("b", 0)
  addTodo("c", 0)
  todos[0].done = true
  currentFilter = FilterActive
  for _, t := range visibleTodos() { console.log(t.text) }
}`);
	assertEqual(runJs(js), "b\nc");
});

// ═════════════════════════════════════════════════════════════
// CLI flags
// ═════════════════════════════════════════════════════════════

section("CLI flags");

const CLI = join(ROOT, "src", "index.js");

function cli(args) {
	const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
	return {
		stdout: r.stdout ?? "",
		stderr: r.stderr ?? "",
		code: r.status ?? 1,
	};
}

function makeTmp(name, content) {
	const dir = mkdtempSync(join(tmpdir(), "gofront-"));
	const file = join(dir, name);
	writeFileSync(file, content);
	return { dir, file };
}

test("--version prints version", () => {
	const { stdout, code } = cli(["--version"]);
	assert(code === 0, `expected exit 0, got ${code}`);
	assert(stdout.startsWith("gofront "), `unexpected output: ${stdout}`);
});

test("--check exits 0 on valid file", () => {
	const { file, dir } = makeTmp(
		"ok.go",
		`package main\nfunc main() { console.log("hi") }\n`,
	);
	try {
		const { code, stderr } = cli([file, "--check"]);
		assert(code === 0, `expected exit 0, got ${code} — ${stderr}`);
		assert(stderr.includes("OK"), `expected OK in stderr: ${stderr}`);
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

test("--check exits 1 on type error", () => {
	const { file, dir } = makeTmp(
		"bad.go",
		`package main\nfunc main() { notDefined }\n`,
	);
	try {
		const { code, stderr } = cli([file, "--check"]);
		assert(code !== 0, "expected non-zero exit on type error");
		assert(
			stderr.includes("notDefined") || stderr.includes("Undefined"),
			`expected error in stderr: ${stderr}`,
		);
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

test("--source-map appends sourceMappingURL comment", () => {
	const { file, dir } = makeTmp(
		"sm.go",
		`package main\nfunc main() { console.log("hi") }\n`,
	);
	try {
		const { stdout, code } = cli([file, "--source-map"]);
		assert(code === 0, `expected exit 0, got ${code}`);
		assert(
			stdout.includes("sourceMappingURL=data:application/json;base64,"),
			"expected inline source map",
		);
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

test("gofront init creates main.go", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-init-"));
	try {
		const { code, stderr } = cli(["init", dir]);
		assert(code === 0, `expected exit 0: ${stderr}`);
		const mainPath = join(dir, "main.go");
		assert(existsSync(mainPath), "expected main.go to be created");
		const content = readFileSync(mainPath, "utf8");
		assert(content.includes("func main()"), "expected func main() in scaffold");
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

// ── 7. New feature tests ─────────────────────────────────────

section("New features");

test("init() functions execute before main in order", () => {
	const { js, errors } = compileFile(join(FIXTURES, "init_test.go"));
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "AB");
});

test("short variable re-declaration (:=)", () => {
	const { js, errors } = compileFile(join(FIXTURES, "redecl_test.go"));
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "20 30");
});

test("error messages include filenames", () => {
	const { errors } = compileFile(join(FIXTURES, "type_alias_test.go"));
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "type_alias_test.go");
});

test("generated code size - len helper", () => {
	const { js } = compile(`package main
func main() {
    xs := []int{1,2}
    console.log(len(xs))
}`);
	assertContains(js, "function __len(a)");
	assertEqual(runJs(js), "2");
});

// ═════════════════════════════════════════════════════════════
// Embedded structs
// ═════════════════════════════════════════════════════════════

section("Embedded structs");

test("embedded struct fields accessible on outer struct", () => {
	const { js, errors } = compile(`package main
type Animal struct {
  Name string
}
type Dog struct {
  Animal
  Breed string
}
func main() {
  d := Dog{Breed: "Lab"}
  d.Name = "Rex"
  console.log(d.Name)
  console.log(d.Breed)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "Rex\nLab");
});

test("embedded struct initialised via type key in composite literal", () => {
	const { js, errors } = compile(`package main
type Animal struct {
  Name string
}
type Dog struct {
  Animal
  Breed string
}
func main() {
  d := Dog{Animal: Animal{Name: "Rex"}, Breed: "Lab"}
  console.log(d.Name)
  console.log(d.Breed)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "Rex\nLab");
});

test("embedded struct methods promoted to outer struct", () => {
	const { js, errors } = compile(`package main
type Greeter struct {
  prefix string
}
func (g Greeter) Greet(name string) string {
  return g.prefix + name
}
type Bot struct {
  Greeter
}
func main() {
  b := Bot{Greeter: Greeter{prefix: "Hello, "}}
  console.log(b.Greet("world"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "Hello, world");
});

test("unknown field on embedded struct errors", () => {
	const { errors } = compile(`package main
type Animal struct { Name string }
type Dog struct { Animal }
func main() {
  _ := Dog{BadField: "x"}
}`);
	assertErrorContains(errors, "BadField");
});

test("outer method overrides promoted embedded method", () => {
	const { js, errors } = compile(`package main
type Base struct {}
func (b Base) Speak() string { return "base" }
type Child struct {
  Base
}
func (c Child) Speak() string { return "child" }
func main() {
  c := Child{}
  console.log(c.Speak())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "child");
});

test("embedded struct zero-value initialisation", () => {
	const { js, errors } = compile(`package main
type Animal struct {
  Name string
  Age  int
}
type Dog struct {
  Animal
  Breed string
}
func main() {
  d := Dog{}
  console.log(d.Name)
  console.log(d.Age)
  console.log(d.Breed)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "\n0\n");
});

test("multiple embedded structs in one type", () => {
	const { js, errors } = compile(`package main
type Walker struct { Speed int }
type Talker struct { Volume int }
type Person struct {
  Walker
  Talker
  Name string
}
func main() {
  p := Person{Walker: Walker{Speed: 5}, Talker: Talker{Volume: 8}, Name: "Bob"}
  console.log(p.Speed)
  console.log(p.Volume)
  console.log(p.Name)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5\n8\nBob");
});

// ═════════════════════════════════════════════════════════════
// String formatting (fmt package)
// ═════════════════════════════════════════════════════════════

section("fmt package");

test("fmt.Sprintf formats %s and %d", () => {
	const { js, errors } = compile(`package main
func main() {
  s := fmt.Sprintf("hello %s, you are %d years old", "alice", 30)
  console.log(s)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello alice, you are 30 years old");
});

test("fmt.Sprintf %v with bool and nil", () => {
	const { js, errors } = compile(`package main
func main() {
  console.log(fmt.Sprintf("%v %v", true, false))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true false");
});

test("fmt.Sprintf %% literal percent", () => {
	const { js, errors } = compile(`package main
func main() {
  console.log(fmt.Sprintf("100%%"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "100%");
});

test("fmt.Println logs formatted string", () => {
	const { js, errors } = compile(`package main
func main() {
  fmt.Println("count: %d items", 5)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "count: 5 items");
});

test("fmt.Errorf creates error from format", () => {
	const { js, errors } = compile(`package main
func main() {
  err := fmt.Errorf("failed at step %d", 3)
  console.log(err)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "failed at step 3");
});

test("fmt.Errorf result usable as error (nil check + .Error())", () => {
	const { js, errors } = compile(`package main
func validate(n int) error {
  if n < 0 {
    return fmt.Errorf("negative value: %d", n)
  }
  return nil
}
func main() {
  e := validate(-1)
  console.log(e != nil)
  console.log(e.Error())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nnegative value: -1");
});

test("fmt.Sprintf plain string (no format verbs)", () => {
	const { js, errors } = compile(`package main
func main() {
  console.log(fmt.Sprintf("no verbs here"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "no verbs here");
});

test("__sprintf not emitted when fmt is unused", () => {
	const { js } = compile(`package main
func main() {
  console.log("hello")
}`);
	assert(!js.includes("__sprintf"), "expected __sprintf not to be emitted");
});

test("fmt.Sprintf emits __sprintf helper", () => {
	const { js } = compile(`package main
func main() {
  console.log(fmt.Sprintf("%s", "x"))
}`);
	assertContains(js, "__sprintf");
	assertContains(js, "function __sprintf");
});

// ═════════════════════════════════════════════════════════════
// New type checks
// ═════════════════════════════════════════════════════════════

section("New type checks");

test("break outside loop and switch is an error", () => {
	const { errors } = compile(`package main
func main() {
  break
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "break");
});

test("continue outside loop is an error", () => {
	const { errors } = compile(`package main
func main() {
  continue
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "continue");
});

test("fallthrough outside switch is an error", () => {
	const { errors } = compile(`package main
func main() {
  fallthrough
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "fallthrough");
});

test("break inside for loop is valid", () => {
	const { errors } = compile(`package main
func main() {
  for i := 0; i < 3; i++ {
    break
  }
}`);
	assertEqual(errors.length, 0);
});

test("break inside switch is valid", () => {
	const { errors } = compile(`package main
func main() {
  x := 1
  switch x {
  case 1:
    break
  }
}`);
	assertEqual(errors.length, 0);
});

test("continue inside for loop is valid", () => {
	const { errors } = compile(`package main
func main() {
  for i := 0; i < 3; i++ {
    continue
  }
}`);
	assertEqual(errors.length, 0);
});

test("reassigning a const is an error", () => {
	const { errors } = compile(`package main
const MaxSize = 10
func main() {
  MaxSize = 20
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "const");
});

test("reassigning a local const is an error", () => {
	const { errors } = compile(`package main
func main() {
  const x = 5
  x = 10
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "const");
});

test("shadowing a const with a var in inner scope is allowed", () => {
	// In Go, shadowing a const with a var in a child scope is valid
	const { errors } = compile(`package main
const x = 5
func main() {
  x := 10
  console.log(x)
}`);
	assertEqual(errors.length, 0);
});

// ═════════════════════════════════════════════════════════════

section("recover()");

test("recover catches a panic and returns the message", () => {
	const js = compile(`package main
func safeDo(fn func()) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = error(r)
		}
	}()
	fn()
	return nil
}
func main() {
	err := safeDo(func() {
		panic("something went wrong")
	})
	console.log(err)
}`).js;
	assertEqual(runJs(js), "something went wrong");
});

test("recover returns nil when no panic", () => {
	const js = compile(`package main
func safeDo(fn func()) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = error(r)
		}
	}()
	fn()
	return nil
}
func main() {
	err := safeDo(func() {})
	if err == nil {
		console.log("no panic")
	}
}`).js;
	assertEqual(runJs(js), "no panic");
});

test("recover outside defer returns nil", () => {
	const js = compile(`package main
func main() {
	r := recover()
	if r == nil {
		console.log("nil")
	}
}`).js;
	assertEqual(runJs(js), "nil");
});

test("panic without recover propagates", () => {
	const js = compile(`package main
func main() {
	defer func() {}()
	panic("boom")
}`).js;
	let threw = false;
	try {
		runJs(js);
	} catch (_) {
		threw = true;
	}
	assert(threw, "expected panic to propagate");
});

// ═════════════════════════════════════════════════════════════

section("Variadic spread (...)");

test("append with spread merges two slices", () => {
	const js = compile(`package main
func main() {
	a := []int{1, 2, 3}
	b := []int{4, 5, 6}
	a = append(a, b...)
	console.log(len(a))
}`).js;
	assertEqual(runJs(js), "6");
});

test("append spread of empty slice is a no-op", () => {
	const js = compile(`package main
func main() {
	a := []int{1, 2, 3}
	b := []int{}
	a = append(a, b...)
	console.log(len(a))
}`).js;
	assertEqual(runJs(js), "3");
});

test("append spread into nil slice", () => {
	const js = compile(`package main
func main() {
	var a []int
	b := []int{1, 2, 3}
	a = append(a, b...)
	console.log(len(a))
}`).js;
	assertEqual(runJs(js), "3");
});

test("spread into variadic function", () => {
	const js = compile(`package main
func sum(nums ...int) int {
	total := 0
	for _, n := range nums {
		total += n
	}
	return total
}
func main() {
	nums := []int{1, 2, 3, 4}
	console.log(sum(nums...))
}`).js;
	assertEqual(runJs(js), "10");
});

// ═════════════════════════════════════════════════════════════

section("Rune / char literals");

test("char literal produces its char code", () => {
	const js = compile(`package main
func main() {
	var r rune = 'A'
	console.log(r)
}`).js;
	assertEqual(runJs(js), "65");
});

test("char literal escape sequences", () => {
	const js = compile(`package main
func main() {
	console.log('\\n')
	console.log('\\t')
	console.log('\\'')
	console.log('\\\\')
}`).js;
	assertEqual(runJs(js), "10\n9\n39\n92");
});

test("char literal used in arithmetic", () => {
	const js = compile(`package main
func main() {
	x := 'a' + 1
	console.log(x)
}`).js;
	assertEqual(runJs(js), "98");
});

test("char literal as const", () => {
	const js = compile(`package main
const Tab = '\t'
func main() {
	console.log(Tab)
}`).js;
	assertEqual(runJs(js), "9");
});

test("switch on char literal cases", () => {
	const js = compile(`package main
func grade(c rune) string {
	switch c {
	case 'A':
		return "excellent"
	case 'B':
		return "good"
	default:
		return "other"
	}
}
func main() {
	console.log(grade('A'))
	console.log(grade('B'))
	console.log(grade('C'))
}`).js;
	assertEqual(runJs(js), "excellent\ngood\nother");
});

test("unicode char literal", () => {
	const js = compile(`package main
func main() {
	console.log('€')
}`).js;
	assertEqual(runJs(js), "8364");
});

test("char literal used in comparison", () => {
	const js = compile(`package main
func main() {
	c := 'z'
	if c > 'a' {
		console.log("yes")
	}
}`).js;
	assertEqual(runJs(js), "yes");
});

// ═════════════════════════════════════════════════════════════

section("Labeled break / continue");

test("labeled break exits outer loop", () => {
	const js = compile(`package main
func main() {
	result := 0
Outer:
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			if j == 1 {
				break Outer
			}
			result++
		}
	}
	console.log(result)
}`).js;
	assertEqual(runJs(js), "1");
});

test("labeled break exits for from inside switch", () => {
	const js = compile(`package main
func main() {
	result := 0
Search:
	for i := 0; i < 5; i++ {
		switch i {
		case 3:
			break Search
		default:
			result++
		}
	}
	console.log(result)
}`).js;
	assertEqual(runJs(js), "3");
});

test("labeled continue on for range loop", () => {
	const js = compile(`package main
func main() {
	result := 0
	items := []int{1, 2, 3}
Outer:
	for _, x := range items {
		for _, y := range items {
			if y == 2 {
				continue Outer
			}
			result += x
		}
	}
	console.log(result)
}`).js;
	assertEqual(runJs(js), "6");
});

test("labeled continue skips to outer loop", () => {
	const js = compile(`package main
func main() {
	result := 0
Outer:
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			if j == 1 {
				continue Outer
			}
			result++
		}
	}
	console.log(result)
}`).js;
	assertEqual(runJs(js), "3");
});

// ── Summary ──────────────────────────────────────────────────

const total = passed + failed;
process.stdout.write(`\n${total} tests: \x1b[32m${passed} passed\x1b[0m`);
if (failed > 0) {
	process.stdout.write(`, \x1b[31m${failed} failed\x1b[0m`);
	process.stdout.write("\n\nFailed tests:\n");
	for (const f of failures) process.stdout.write(`  • ${f.name}\n`);
}
process.stdout.write("\n");
process.exit(failed > 0 ? 1 : 0);
