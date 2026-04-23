// GoFront test suite — .templ file support
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileDir } from "../../src/compiler.js";
import {
	assert,
	assertContains,
	assertEqual,
	assertThrows,
	runInDom,
	section,
	summarize,
	test,
} from "./helpers.js";

// Helper: creates a temp dir with given files and compiles it
function compilePkg(files) {
	const dir = mkdtempSync(join(tmpdir(), "gofront-templ-"));
	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(dir, name), content);
	}
	return compileDir(dir);
}

// ── Basic element rendering ───────────────────────────────────

section("templ — basic elements");

test("simple div element", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Hello())
}`,
		"hello.templ": `package main
templ Hello() {
	<div>hello world</div>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app div").textContent, "hello world");
});

test("nested elements", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Card())
}`,
		"card.templ": `package main
templ Card() {
	<div class="card">
		<h1>Title</h1>
		<p>Body</p>
	</div>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app h1").textContent, "Title");
	assertEqual(document.querySelector("#app p").textContent, "Body");
});

// ── Expression interpolation ──────────────────────────────────

section("templ — expression interpolation");

test("string expression interpolation", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Greeting("World"))
}`,
		"greet.templ": `package main
templ Greeting(name string) {
	<p>Hello, { name }!</p>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertContains(document.querySelector("#app p").textContent, "Hello,");
	assertContains(document.querySelector("#app p").textContent, "World");
});

test("non-string expression interpolation uses String()", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", ShowCount(42))
}`,
		"count.templ": `package main
templ ShowCount(n int) {
	<span>{ n }</span>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app span").textContent, "42");
});

// ── Static attributes ─────────────────────────────────────────

section("templ — attributes");

test("static string attribute", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", MyLink())
}`,
		"link.templ": `package main
templ MyLink() {
	<a href="https://example.com">click</a>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(
		document.querySelector("#app a").getAttribute("href"),
		"https://example.com",
	);
});

test("expression attribute", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Classed("highlight"))
}`,
		"classed.templ": `package main
templ Classed(cls string) {
	<div class={ cls }>content</div>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app div").className, "highlight");
});

test("boolean attribute", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", DisabledInput())
}`,
		"disabled.templ": `package main
templ DisabledInput() {
	<input disabled/>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assert(
		document.querySelector("#app input").hasAttribute("disabled"),
		"input should be disabled",
	);
});

test("self-closing tag", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", MyInput())
}`,
		"input.templ": `package main
templ MyInput() {
	<input type="text"/>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app input").type, "text");
});

// ── @component calls ──────────────────────────────────────────

section("templ — @component calls");

test("@component call with no args", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Page())
}`,
		"page.templ": `package main
templ Inner() {
	<span>inner</span>
}
templ Page() {
	<div>
		@Inner()
	</div>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app span").textContent, "inner");
});

test("@component call with args", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Wrapper())
}`,
		"wrapper.templ": `package main
templ Item(label string) {
	<li>{ label }</li>
}
templ Wrapper() {
	<ul>
		@Item("alpha")
		@Item("beta")
	</ul>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	const items = document.querySelectorAll("#app li");
	assertEqual(items.length, 2);
	assertEqual(items[0].textContent, "alpha");
	assertEqual(items[1].textContent, "beta");
});

// ── Control flow ──────────────────────────────────────────────

section("templ — if/for control flow");

test("if/else control flow", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Cond(true))
}`,
		"cond.templ": `package main
templ Cond(show bool) {
	if show {
		<p>visible</p>
	} else {
		<p>hidden</p>
	}
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app p").textContent, "visible");
});

test("for range loop", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", List([]string{"a", "b", "c"}))
}`,
		"list.templ": `package main
templ List(items []string) {
	<ul>
		for _, item := range items {
			<li>{ item }</li>
		}
	</ul>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	const lis = document.querySelectorAll("#app li");
	assertEqual(lis.length, 3);
	assertEqual(lis[0].textContent, "a");
	assertEqual(lis[2].textContent, "c");
});

// ── children slot ─────────────────────────────────────────────

section("templ — children slot");

test("children pass-through slot", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Layout(gom.El("p", gom.Text("child content"))))
}`,
		"layout.templ": `package main
templ Layout(children ...gom.Node) {
	<div class="layout">
		{ children... }
	</div>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(
		document.querySelector("#app .layout p").textContent,
		"child content",
	);
});

// ── Multi-file package ────────────────────────────────────────

section("templ — multi-file packages");

test("mixed .go and .templ files in same package", () => {
	const { js } = compilePkg({
		"main.go": `package main
func greeting() string {
	return "hi from go"
}
func main() {
	gom.Mount("#app", Hello())
}`,
		"hello.templ": `package main
templ Hello() {
	<p>{ greeting() }</p>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app p").textContent, "hi from go");
});

// ── else if chains ────────────────────────────────────────────

section("templ — else if chains");

test("else if chain with 3 branches picks correct branch", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Status(2))
}`,
		"status.templ": `package main
templ Status(n int) {
	if n == 1 {
		<span>one</span>
	} else if n == 2 {
		<span>two</span>
	} else if n == 3 {
		<span>three</span>
	} else {
		<span>other</span>
	}
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app span").textContent, "two");
});

test("else if chain falls through to else", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Status(99))
}`,
		"status.templ": `package main
templ Status(n int) {
	if n == 1 {
		<span>one</span>
	} else if n == 2 {
		<span>two</span>
	} else {
		<span>other</span>
	}
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app span").textContent, "other");
});

// ── switch ────────────────────────────────────────────────────

section("templ — switch");

/*
test("switch matches correct case", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Tab("b"))
}`,
		"tab.templ": `package main
templ Tab(s string) {
	switch s {
	case "a":
		<span>Alpha</span>
	case "b":
		<span>Beta</span>
	default:
		<span>Other</span>
	}
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app span").textContent, "Beta");
});

test("switch default branch", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Tab("x"))
}`,
		"tab.templ": `package main
templ Tab(s string) {
	switch s {
	case "a":
		<span>Alpha</span>
	default:
		<span>Other</span>
	}
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app span").textContent, "Other");
});

test("switch renders HTML elements per case", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Badge(2))
}`,
		"badge.templ": `package main
templ Badge(n int) {
	switch n {
	case 1:
		<span class="low">low</span>
	case 2:
		<span class="mid">mid</span>
	case 3:
		<span class="high">high</span>
	}
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app span").className, "mid");
	assertEqual(document.querySelector("#app span").textContent, "mid");
});
*/

// ── @templ.Raw() ──────────────────────────────────────────────

section("templ — @templ.Raw()");

/*
test("@templ.Raw() injects raw HTML", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", RawHtml())
}`,
		"raw.templ": `package main
templ RawHtml() {
	<div>
		@templ.Raw("<strong>bold</strong>")
	</div>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assert(
		document.querySelector("#app strong") !== null,
		"strong element should exist",
	);
	assertEqual(document.querySelector("#app strong").textContent, "bold");
});

test("@templ.Raw() with dynamic expression", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", RawHtml("<em>italic</em>"))
}`,
		"raw.templ": `package main
templ RawHtml(html string) {
	<div>
		@templ.Raw(html)
	</div>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assert(document.querySelector("#app em") !== null, "em element should exist");
	assertEqual(document.querySelector("#app em").textContent, "italic");
});
*/

// ── Error cases ───────────────────────────────────────────────

section("templ — error cases");

test("unclosed tag throws parse error", () => {
	assertThrows(
		() =>
			compilePkg({
				"main.go": "package main\nfunc main() {}",
				"bad.templ": `package main
templ Bad() {
	<div>
		<p>unclosed
}`,
			}),
		"unclosed",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
