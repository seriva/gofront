import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TemplLexer } from "../../../src/lexer/templ-lexer.js";
import { TemplParser } from "../../../src/parser/templ.js";
import {
	assert,
	assertContains,
	assertEqual,
	assertThrows,
	compileDir,
	ROOT,
	runInDom,
	section,
	summarize,
	test,
	withTempDir,
} from "../helpers.js";

// Helper: creates a temp dir with given files, compiles it, and cleans up
function compilePkg(files) {
	return withTempDir(files, (dir) => compileDir(dir));
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

test("svg subtree uses the SVG namespace and class attribute", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Icon("icon big"))
}`,
		"icon.templ": `package main
templ Icon(cls string) {
	<div>
		<svg class={ cls } viewBox="0 0 24 24">
			<path class="stroke" d="M0 0h24v24H0z"></path>
		</svg>
		<span class="after">x</span>
	</div>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	const svg = document.querySelector("#app svg");
	const path = document.querySelector("#app path");
	const span = document.querySelector("#app span");
	assertEqual(svg.namespaceURI, "http://www.w3.org/2000/svg");
	assertEqual(path.namespaceURI, "http://www.w3.org/2000/svg");
	assertEqual(svg.getAttribute("class"), "icon big");
	assertEqual(path.getAttribute("class"), "stroke");
	assertEqual(span.namespaceURI, "http://www.w3.org/1999/xhtml");
	assertEqual(span.className, "after");
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

const variadicWrapper = `package main
templ V() {
	<p>v</p>
}
templ W(children ...gom.Node) {
	<div>{ children... }</div>
}
templ X(ns []gom.Node) {
	@W(ns...)
}
templ Y() {
	@W(V(), V())
}
templ Z() {
	@W()
}`;

for (const [name, call] of [
	["templ→templ spread @W(ns...)", "X([]gom.Node{V(), V()})"],
	["Go→templ spread W(ns...)", "W([]gom.Node{V(), V()}...)"],
	["plain @W(V(), V())", "Y()"],
]) {
	test(`variadic children: ${name}`, () => {
		const { js } = compilePkg({
			"main.go": `package main
func main() {
	gom.Mount("#app", ${call})
}`,
			"w.templ": variadicWrapper,
		});
		const { document } = runInDom(js, '<div id="app"></div>');
		assertEqual(
			document.querySelector("#app").innerHTML,
			"<div><p>v</p><p>v</p></div>",
		);
	});
}

test("variadic children: @W() with no args renders an empty wrapper", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Z())
}`,
		"w.templ": variadicWrapper,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app").innerHTML, "<div></div>");
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

test("switch matches correct case", () => {
	const switchTempl = [
		"package main",
		"templ Tab(s string) {",
		"\tswitch s {",
		'\tcase "a":',
		"\t\t<span>Alpha</span>",
		'\tcase "b":',
		"\t\t<span>Beta</span>",
		"\tdefault:",
		"\t\t<span>Other</span>",
		"\t}",
		"}",
	].join("\n");
	const { js } = compilePkg({
		"main.go": `package main\nfunc main() { gom.Mount("#app", Tab("b")) }`,
		"tab.templ": switchTempl,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app span").textContent, "Beta");
});

test("switch default branch", () => {
	const switchTempl = [
		"package main",
		"templ Tab(s string) {",
		"\tswitch s {",
		'\tcase "a":',
		"\t\t<span>Alpha</span>",
		"\tdefault:",
		"\t\t<span>Other</span>",
		"\t}",
		"}",
	].join("\n");
	const { js } = compilePkg({
		"main.go": `package main\nfunc main() { gom.Mount("#app", Tab("x")) }`,
		"tab.templ": switchTempl,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app span").textContent, "Other");
});

test("switch renders HTML elements per case", () => {
	const switchTempl = [
		"package main",
		"templ Badge(n int) {",
		"\tswitch n {",
		"\tcase 1:",
		'\t\t<span class="low">low</span>',
		"\tcase 2:",
		'\t\t<span class="mid">mid</span>',
		"\tcase 3:",
		'\t\t<span class="high">high</span>',
		"\t}",
		"}",
	].join("\n");
	const { js } = compilePkg({
		"main.go": `package main\nfunc main() { gom.Mount("#app", Badge(2)) }`,
		"badge.templ": switchTempl,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app span").className, "mid");
	assertEqual(document.querySelector("#app span").textContent, "mid");
});

// ── @templ.Raw() ──────────────────────────────────────────────

section("templ — @templ.Raw()");

test("@templ.Raw() injects raw HTML", () => {
	const rawTempl = [
		"package main",
		"templ RawHtml() {",
		"\t<div>",
		'\t\t@templ.Raw("<strong>bold</strong>")',
		"\t</div>",
		"}",
	].join("\n");
	const { js } = compilePkg({
		"main.go": `package main\nfunc main() { gom.Mount("#app", RawHtml()) }`,
		"raw.templ": rawTempl,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assert(
		document.querySelector("#app strong") !== null,
		"strong element should exist",
	);
	assertEqual(document.querySelector("#app strong").textContent, "bold");
});

test("@templ.Raw() with dynamic expression", () => {
	const rawTempl = [
		"package main",
		"templ RawHtml(html string) {",
		"\t<div>",
		"\t\t@templ.Raw(html)",
		"\t</div>",
		"}",
	].join("\n");
	const { js } = compilePkg({
		"main.go": `package main\nfunc main() { gom.Mount("#app", RawHtml("<em>italic</em>")) }`,
		"raw.templ": rawTempl,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assert(document.querySelector("#app em") !== null, "em element should exist");
	assertEqual(document.querySelector("#app em").textContent, "italic");
});

// ── Conditional bool attribute ────────────────────────────────

section("templ — conditional bool attribute");

test("?= sets attribute when true", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", MyCheck(true))
}`,
		"check.templ": `package main
templ MyCheck(checked bool) {
	<input type="checkbox" checked?={ checked }/>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assert(
		document.querySelector("#app input").hasAttribute("checked"),
		"checked attribute should be set",
	);
});

test("?= omits attribute when false", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", MyCheck(false))
}`,
		"check.templ": `package main
templ MyCheck(checked bool) {
	<input type="checkbox" checked?={ checked }/>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assert(
		!document.querySelector("#app input").hasAttribute("checked"),
		"checked attribute should be absent",
	);
});

// ── Void elements ─────────────────────────────────────────────

section("templ — void elements");

test("void element without self-close slash", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Rule())
}`,
		"rule.templ": `package main
templ Rule() {
	<div>
		<hr>
		<br>
	</div>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assert(document.querySelector("#app hr") !== null, "hr should exist");
	assert(document.querySelector("#app br") !== null, "br should exist");
});

// ── else if without trailing else ─────────────────────────────

section("templ — else if without else");

test("else if chain with no final else renders nothing when unmatched", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Label(99))
}`,
		"label.templ": `package main
templ Label(n int) {
	<div>
		if n == 1 {
			<span>one</span>
		} else if n == 2 {
			<span>two</span>
		}
	</div>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelectorAll("#app span").length, 0);
});

// ── Error cases ───────────────────────────────────────────────

section("templ — error cases");

test("mismatched close tag throws parse error", () => {
	assertThrows(
		() =>
			compilePkg({
				"main.go": "package main\nfunc main() {}",
				"bad.templ": `package main
templ Bad() {
	<div><span></div>
}`,
			}),
		"unclosed",
	);
});

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

// ── css declarations ──────────────────────────────────────────

section("templ — css declarations");

test("basic css declaration generates scoped class and function", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Card())
}`,
		"card.templ": `package main

css cardStyle() {
	background: #111;
	color: #eee;
}

templ Card() {
	<div class={ cardStyle() }>Card content</div>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	const el = document.querySelector("#app div");
	assert(el.className.startsWith("gfc_cardStyle_"));
	assertEqual(el.textContent, "Card content");
	const style = document.getElementById("gofront-styles");
	assert(style !== null);
	assertContains(style.textContent, el.className);
	assertContains(style.textContent, "background: #111;");
});

test("css declaration with CSS nesting and pseudo selectors", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Btn())
}`,
		"btn.templ": `package main

css btnStyle() {
	background: red;
	&:hover {
		background: blue;
	}
	@media (max-width: 600px) {
		padding: 4px;
	}
}

templ Btn() {
	<button class={ btnStyle() }>Click</button>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	const el = document.querySelector("#app button");
	assert(el.className.startsWith("gfc_btnStyle_"));
	const style = document.getElementById("gofront-styles");
	assertContains(style.textContent, "&:hover");
	assertContains(style.textContent, "@media (max-width: 600px)");
});

test("css declaration preserves strings with braces and comments", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Box())
}`,
		"box.templ": `package main

css boxStyle() {
	/* comment with { nested } braces */
	content: "{ hello }";
	color: 'white';
}

templ Box() {
	<div class={ boxStyle() }>Box</div>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	const el = document.querySelector("#app div");
	assert(el.className.startsWith("gfc_boxStyle_"));
	const style = document.getElementById("gofront-styles");
	assertContains(style.textContent, 'content: "{ hello }";');
});

test("css declaration can be combined with other classes", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", Item())
}`,
		"item.templ": `package main

css itemStyle() {
	border: 1px solid green;
}

templ Item() {
	<div class={ "custom-item " + itemStyle() }>Item</div>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	const el = document.querySelector("#app div");
	assert(el.className.includes("custom-item"));
	assert(el.className.includes("gfc_itemStyle_"));
});

test("css declaration exported across packages", () => {
	const { js } = compilePkg({
		"main.go": `package main
import "./ui"
func main() {
	gom.Mount("#app", Card())
}`,
		"ui/theme.templ": `package ui

css CardStyle() {
	padding: 16px;
}`,
		"card.templ": `package main
import "./ui"

templ Card() {
	<div class={ ui.CardStyle() }>Card</div>
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	const el = document.querySelector("#app div");
	assert(el.className.startsWith("gfc_CardStyle_"));
	const style = document.getElementById("gofront-styles");
	assertContains(style.textContent, "padding: 16px;");
});

test("unclosed css block throws parse error", () => {
	assertThrows(
		() =>
			compilePkg({
				"main.go": "package main\nfunc main() {}",
				"bad.templ": `package main
css broken() {
	color: red;
`,
			}),
		"unclosed",
	);
});

// ── Syntax errors in templ expressions (pinned output) ────────

section("templ — expression syntax errors");

const CLI = join(ROOT, "src", "index.js");

function cli(args) {
	const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
	return {
		stdout: r.stdout ?? "",
		stderr: r.stderr ?? "",
		code: r.status ?? 1,
	};
}

// Runs `build` and `check` on a package holding the given files.
function runBoth(files) {
	return withTempDir(files, (dir) => ({
		build: cli(["build", dir, "-o", join(dir, "out")]),
		check: cli(["check", dir]),
	}));
}

const EOF_PARSE_ERROR =
	"Parse error at 1:1: Unexpected token in expression: '' (got EOF \"\")";

const MAIN_GO = "package main\nfunc main() {}\n";

for (const [name, body] of [
	["text expression", "<p>{ a + }</p>"],
	["attribute expression", "<p class={ a + }>x</p>"],
	["conditional attribute", "<p disabled?={ a + }>x</p>"],
	["if condition", "if a + {\n\t\t<p>x</p>\n\t}"],
	["switch expression", "switch a + {\n\tcase 1:\n\t\t<p>x</p>\n\t}"],
]) {
	test(`malformed ${name} fails build and check with the synthetic EOF position`, () => {
		const { build, check } = runBoth({
			"main.go": MAIN_GO,
			"bad.templ": `package main
templ Bad(a int) {
	${body}
}
templ Other(a int) {
	<i>x</i>
}`,
		});
		for (const r of [build, check]) {
			assertEqual(r.code, 1);
			assertEqual(r.stderr, `gofront: ERROR\n  ${EOF_PARSE_ERROR}\n`);
		}
	});
}

for (const [name, body] of [
	["if", "if {\n\t\t<p>a</p>\n\t} else {\n\t\t<p>b</p>\n\t}"],
	["else if", "if a {\n\t\t<p>a</p>\n\t} else if {\n\t\t<p>b</p>\n\t}"],
	[
		"chained else if",
		"if a {\n\t\t<p>a</p>\n\t} else if a {\n\t\t<p>b</p>\n\t} else if {\n\t\t<p>c</p>\n\t} else {\n\t\t<p>d</p>\n\t}",
	],
]) {
	test(`empty ${name} condition fails build and check with the synthetic EOF position`, () => {
		const { build, check } = runBoth({
			"main.go": MAIN_GO,
			"bad.templ": `package main
templ Bad(a bool) {
	${body}
}`,
		});
		for (const r of [build, check]) {
			assertEqual(r.code, 1);
			assertEqual(r.stderr, `gofront: ERROR\n  ${EOF_PARSE_ERROR}\n`);
		}
	});
}

test("malformed component call fails build and check at the real token position", () => {
	const { build, check } = runBoth({
		"main.go": MAIN_GO,
		"bad.templ": `package main
templ Bad(a int) {
	@Other(a +)
}
templ Other(a int) {
	<i>x</i>
}`,
	});
	for (const r of [build, check]) {
		assertEqual(r.code, 1);
		assertEqual(
			r.stderr,
			"gofront: ERROR\n  Parse error at 1:10: Unexpected token in expression: ')' (got ) \")\")\n",
		);
	}
});

test("malformed for header fails build and check with a parse error", () => {
	const { build, check } = runBoth({
		"main.go": MAIN_GO,
		"bad.templ": `package main
templ Bad(xs []int) {
	for x := range {
		<p>hi</p>
	}
}`,
	});
	for (const r of [build, check]) {
		assertEqual(r.code, 1);
		assertContains(r.stderr, "Parse error");
	}
});

test("malformed expression inside a for body fails build and check", () => {
	const { build, check } = runBoth({
		"main.go": MAIN_GO,
		"bad.templ": `package main
templ Bad(xs []int) {
	for _, x := range xs {
		<p>{ x + }</p>
	}
}`,
	});
	for (const r of [build, check]) {
		assertEqual(r.code, 1);
		assertEqual(r.stderr, `gofront: ERROR\n  ${EOF_PARSE_ERROR}\n`);
	}
});

test("valid for loops still build: range forms and a condition loop", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", L([]string{"a", "b"}))
}`,
		"l.templ": `package main
templ L(xs []string) {
	for i, x := range xs {
		<p>{ i }{ x }</p>
	}
	for _, x := range xs {
		<i>{ x }</i>
	}
	for false {
		<s>never</s>
	}
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	const ps = [...document.querySelectorAll("#app p")].map((e) => e.textContent);
	assertEqual(ps.join(","), "0a,1b");
	assertEqual(document.querySelectorAll("#app i").length, 2);
	assertEqual(document.querySelectorAll("#app s").length, 0);
});

test("a type error is reported before a malformed templ expression", () => {
	const { build, check } = runBoth({
		"main.go": 'package main\nfunc main() { var x int = "s"; _ = x }\n',
		"bad.templ": `package main
templ Bad(a int) {
	<p>{ a + }</p>
}`,
	});
	for (const r of [build, check]) {
		assertEqual(r.code, 1);
		assertContains(r.stderr, "Type error in main.go at line 2:27");
		assert(!r.stderr.includes("Parse error"), r.stderr);
	}
});

test("a malformed templ expression is not reported by the parser", () => {
	const src = `package main
templ Bad(a int) {
	<p>{ a + }</p>
}
`;
	const tokens = new TemplLexer(src, "bad.templ").tokenize();
	const ast = new TemplParser(tokens, "bad.templ", src).parse();
	assertEqual(ast.decls[0].kind, "TemplDecl");
});

// ── Parsed expressions on the templ AST ───────────────────────

section("templ — parsed expressions");

function parseTempl(body) {
	const src = `package main
templ V(name string, xs []int) {
${body}
}
`;
	const tokens = new TemplLexer(src, "v.templ").tokenize();
	const ast = new TemplParser(tokens, "v.templ", src).parse();
	return ast.decls[0].body;
}

test("{ name } carries its parsed expression", () => {
	const [node] = parseTempl("<p>{ name }</p>")[0].children;
	assertEqual(node.kind, "TemplExpr");
	assertEqual(node.expr.kind, "Ident");
	assertEqual(node.expr.name, "name");
});

test("attribute expressions are parsed on the attribute", () => {
	const [el] = parseTempl(
		'<p class={ name } hidden?={ name != "" } id="a">x</p>',
	);
	const [cls, hidden, id] = el.attrs;
	assertEqual(cls.expr.kind, "Ident");
	assertEqual(hidden.expr.kind, "BinaryExpr");
	assertEqual(id.expr, undefined);
});

test("if, switch, case and component expressions are parsed", () => {
	const nodes = parseTempl(
		'if name != "" {\n<p>x</p>\n}\nswitch name {\ncase "a":\n<p>a</p>\ndefault:\n<p>b</p>\n}\n@V(name, xs)\n@templ.Raw(name)',
	);
	const [ifNode, sw, comp, raw] = nodes;
	assertEqual(ifNode.expr.kind, "BinaryExpr");
	assertEqual(sw.expr.kind, "Ident");
	assertEqual(sw.cases[0].expr.kind, "BasicLit");
	assertEqual(sw.cases[1].expr, null);
	assertEqual(comp.expr.kind, "CallExpr");
	assertEqual(comp.raw, false);
	assertEqual(raw.raw, true);
	assertEqual(raw.expr.kind, "Ident");
});

test("for headers are parsed into forStmt", () => {
	const [loop] = parseTempl("for i, x := range xs {\n<p>{ x }</p>\n}");
	assertEqual(loop.kind, "TemplFor");
	assertEqual(loop.forStmt.kind, "ForStmt");
	assertEqual(loop.forStmt.init.rhs[0].kind, "RangeExpr");
	const [bad] = parseTempl("for x := range {\n<p>hi</p>\n}");
	assertEqual(bad.forStmt, null);
	assertContains(bad.forError.message, "Parse error");
});

test("a malformed expression is kept on the node, not thrown", () => {
	const [node] = parseTempl("<p>{ name + }</p>")[0].children;
	assertEqual(node.expr, null);
	assertContains(node.exprError.message, "Unexpected token in expression");
});

test("parsed expressions are invisible to generic AST walkers", () => {
	const [node] = parseTempl("<p>{ name }</p>")[0].children;
	assert(!Object.keys(node).includes("expr"), "expr must not be enumerable");
});

test("the JS code generator does not import the parser", () => {
	const src = readFileSync(
		join(ROOT, "src", "backend", "js", "templ.js"),
		"utf8",
	);
	assert(!/from\s+["'][^"']*parser\//.test(src), "templ.js imports parser/");
	assert(!src.includes("new Parser"), "templ.js builds a Parser");
	assert(!src.includes("parseExpr"), "templ.js calls parseExpr");
});

test("compiling the same templ package twice gives the same output", () => {
	const files = {
		"main.go": MAIN_GO,
		"v.templ": `package main
templ V(xs []int, name string) {
	<ul class={ name }>
		for _, x := range xs {
			<li>{ x }</li>
		}
	</ul>
}`,
	};
	assertEqual(compilePkg(files).js, compilePkg(files).js);
});

// ── Reserved-name parameters ──────────────────────────────────

section("templ — reserved-name parameters");

for (const name of ["class", "function", "delete", "let", "this", "typeof"]) {
	test(`a parameter named ${name} is renamed in the templ body`, () => {
		const { js } = compilePkg({
			"main.go": MAIN_GO,
			"v.templ": `package main
templ V(${name} string) {
	<p class={ ${name} }>{ ${name} }</p>
}`,
		});
		assertContains(js, `String(${name}$)`);
		assert(!js.includes(`String(${name})`), `raw ${name} in body`);
		new Function(js);
	});
}

test("reserved-name parameters render in the DOM", () => {
	const { js } = compilePkg({
		"main.go": `package main
func main() {
	gom.Mount("#app", V("c", []string{"a", "b"}))
}`,
		"v.templ": `package main
templ V(class string, function []string) {
	<p class={ class }>{ class }</p>
	if class != "" {
		for _, let := range function {
			<i>{ let }</i>
		}
	}
	switch class {
	case "c":
		<b>{ class }</b>
	}
}`,
	});
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app p").className, "c");
	assertEqual(document.querySelector("#app p").textContent, "c");
	const items = [...document.querySelectorAll("#app i")].map(
		(e) => e.textContent,
	);
	assertEqual(items.join(","), "a,b");
	assertEqual(document.querySelector("#app b").textContent, "c");
});

// ── Type checking templ expressions ───────────────────────────

section("templ — type checking");

function checkTempl(templBody, params = "name string, xs []int") {
	return runBoth({
		"main.go": MAIN_GO,
		"v.templ": `package main
templ V(${params}) {
	${templBody}
}`,
	});
}

test("an undefined name in a templ expression is a type error", () => {
	const { build, check } = checkTempl("<p>{ name + undefinedVar }</p>");
	for (const r of [build, check]) {
		assertEqual(r.code, 1);
		assertContains(r.stderr, "Undefined: 'undefinedVar'");
	}
});

test("mismatched operand types in a templ expression are a type error", () => {
	const { build, check } = checkTempl("<p>{ name + 5 }</p>");
	for (const r of [build, check]) {
		assertEqual(r.code, 1);
		assertContains(r.stderr, "Invalid operation: string + untyped int");
	}
});

for (const [where, body] of [
	["an attribute", "<p class={ nope }>x</p>"],
	["a conditional attribute", "<p hidden?={ nope }>x</p>"],
	["an if condition", "if nope {\n\t\t<p>x</p>\n\t}"],
	["a switch expression", "switch nope {\n\tcase 1:\n\t\t<p>x</p>\n\t}"],
	["a case expression", "switch name {\n\tcase nope:\n\t\t<p>x</p>\n\t}"],
	["a component call", "@V(nope, xs)"],
	["templ.Raw", "@templ.Raw(nope)"],
	["a for header", "for _, x := range nope {\n\t\t<p>{ x }</p>\n\t}"],
	["a for body", "for _, x := range xs {\n\t\t<p>{ x + nope }</p>\n\t}"],
]) {
	test(`an undefined name in ${where} is a type error`, () => {
		const { build, check } = checkTempl(body);
		for (const r of [build, check]) {
			assertEqual(r.code, 1);
			assertContains(r.stderr, "Undefined: 'nope'");
		}
	});
}

test("a non-bool if condition is a type error", () => {
	const { build, check } = checkTempl("if name {\n\t\t<p>x</p>\n\t}");
	for (const r of [build, check]) {
		assertEqual(r.code, 1);
		assertContains(r.stderr, "If condition must be bool");
	}
});

test("a wrong component argument type is a type error", () => {
	const { build, check } = checkTempl("@V(5, xs)");
	for (const r of [build, check]) {
		assertEqual(r.code, 1);
		assertContains(r.stderr, "Type error");
	}
});

test("loop variables are scoped to the templ for body", () => {
	const { build, check } = checkTempl(
		"for _, x := range xs {\n\t\t<p>{ x }</p>\n\t}\n\t<p>{ x }</p>",
	);
	for (const r of [build, check]) {
		assertEqual(r.code, 1);
		assertContains(r.stderr, "Undefined: 'x'");
	}
});

test("an unused templ loop variable is reported as in Go", () => {
	const { build, check } = checkTempl(
		"for i, x := range xs {\n\t\t<p>{ x }</p>\n\t}",
	);
	for (const r of [build, check]) {
		assertEqual(r.code, 1);
		assertContains(r.stderr, "declared and not used");
	}
});

test("well-typed templ expressions check clean", () => {
	const { build, check } = runBoth({
		"main.go": `package main
type Item struct{ Name string; N int }
func label(i Item) string { return i.Name }
func main() {}`,
		"v.templ": `package main
templ Row(it Item) {
	<li class={ label(it) } data-n={ it.N } hidden?={ it.N == 0 }>{ it.Name }{ it.N * 2 }</li>
}
templ V(items []Item, title string, children ...gom.Node) {
	@templ.Raw("<b>" + title + "</b>")
	if len(items) == 0 {
		<p>none</p>
	} else if title != "" {
		for i, it := range items {
			<span>{ i }</span>
			@Row(it)
		}
	}
	switch len(items) {
	case 0:
		<p>zero</p>
	default:
		<p>{ len(items) }</p>
	}
	{ children... }
}`,
	});
	for (const r of [build, check]) {
		assertEqual(r.code, 0);
		assert(!r.stderr.includes("ERROR"), r.stderr);
	}
});

test("example/templ checks clean", () => {
	const r = cli(["check", join(ROOT, "example", "templ")]);
	assertEqual(r.code, 0);
	assert(!r.stderr.includes("ERROR"), r.stderr);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
