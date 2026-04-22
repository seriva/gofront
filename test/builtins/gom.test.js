// GoFront test suite — gom built-in namespace
import { fileURLToPath } from "node:url";
import {
	assert,
	assertEqual,
	assertErrorContains,
	compile,
	runInDom,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

// ── Core functions ────────────────────────────────────────────

section("gom — El and Text");

test("gom.El creates element and mounts to parent", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.El("div"))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app div").tagName, "DIV");
});

test("gom.Text creates text node", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.El("p", gom.Text("hello")))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app p").textContent, "hello");
});

test("gom.El with multiple children", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.El("ul",
		gom.El("li", gom.Text("one")),
		gom.El("li", gom.Text("two")),
		gom.El("li", gom.Text("three")),
	))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	const items = document.querySelectorAll("#app li");
	assertEqual(items.length, 3);
	assertEqual(items[0].textContent, "one");
	assertEqual(items[2].textContent, "three");
});

test("gom.Mount clears existing content", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.El("span", gom.Text("new")))
}`);
	const { document } = runInDom(js, '<div id="app"><p>old</p></div>');
	assertEqual(document.querySelector("#app p"), null);
	assertEqual(document.querySelector("#app span").textContent, "new");
});

// ── Attributes ────────────────────────────────────────────────

section("gom — Attr and attribute helpers");

test("gom.Attr sets attribute", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.El("a", gom.Attr("href", "https://example.com"), gom.Text("link")))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(
		document.querySelector("#app a").getAttribute("href"),
		"https://example.com",
	);
});

test("gom.Class sets className", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.El("div", gom.Class("card active")))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app div").className, "card active");
});

test("gom.Type sets input type", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.El("input", gom.Type("checkbox")))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app input").type, "checkbox");
});

test("gom.Href sets href", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.A(gom.Href("https://example.com"), gom.Text("x")))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(
		document.querySelector("#app a").getAttribute("href"),
		"https://example.com",
	);
});

test("gom.Placeholder sets placeholder", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.Input(gom.Type("text"), gom.Placeholder("type here")))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app input").placeholder, "type here");
});

test("gom.DataAttr sets data attribute", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.El("div", gom.DataAttr("todo-id", "42")))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(
		document.querySelector("#app div").getAttribute("data-todo-id"),
		"42",
	);
});

test("gom.Checked sets checked attribute", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.Input(gom.Type("checkbox"), gom.Checked()))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assert(document.querySelector("#app input").hasAttribute("checked"));
});

test("gom.Disabled sets disabled attribute", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.Button(gom.Disabled(), gom.Text("ok")))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assert(document.querySelector("#app button").hasAttribute("disabled"));
});

test("gom.Target sets target attribute", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.A(gom.Target("_blank"), gom.Text("x")))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(
		document.querySelector("#app a").getAttribute("target"),
		"_blank",
	);
});

test("gom.StyleAttr sets style attribute", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.Span(gom.StyleAttr("display:none")))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(
		document.querySelector("#app span").getAttribute("style"),
		"display:none",
	);
});

// ── Element helpers ───────────────────────────────────────────

section("gom — element helpers");

test("block element helpers render correct tags", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.Div(
		gom.Header(gom.H1(gom.Text("title"))),
		gom.Main(gom.P(gom.Text("body"))),
		gom.Footer(gom.Span(gom.Text("foot"))),
	))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app header h1").textContent, "title");
	assertEqual(document.querySelector("#app main p").textContent, "body");
	assertEqual(document.querySelector("#app footer span").textContent, "foot");
});

test("list helpers render ul/ol/li", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.Ul(
		gom.Li(gom.Text("a")),
		gom.Li(gom.Text("b")),
	))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelectorAll("#app li").length, 2);
	assertEqual(document.querySelector("#app li").textContent, "a");
});

test("form helpers render input/button", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.Form(
		gom.Input(gom.Type("text")),
		gom.Button(gom.Type("submit"), gom.Text("Go")),
	))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app input").type, "text");
	assertEqual(document.querySelector("#app button").textContent, "Go");
});

test("heading helpers H1-H6", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.Div(
		gom.H1(gom.Text("h1")),
		gom.H2(gom.Text("h2")),
		gom.H3(gom.Text("h3")),
	))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("h1").textContent, "h1");
	assertEqual(document.querySelector("h2").textContent, "h2");
	assertEqual(document.querySelector("h3").textContent, "h3");
});

test("inline helpers Strong, Em, Code", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.P(
		gom.Strong(gom.Text("bold")),
		gom.Em(gom.Text("italic")),
		gom.Code(gom.Text("code")),
	))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("strong").textContent, "bold");
	assertEqual(document.querySelector("em").textContent, "italic");
	assertEqual(document.querySelector("code").textContent, "code");
});

// ── Conditional rendering ─────────────────────────────────────

section("gom — If");

test("gom.If renders node when true", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.Div(gom.If(true, gom.Span(gom.Text("visible")))))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app span").textContent, "visible");
});

test("gom.If renders nothing when false", () => {
	const { js } = compile(`package main
func main() {
	gom.Mount("#app", gom.Div(gom.If(false, gom.Span(gom.Text("hidden")))))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app span"), null);
});

test("gom.If with variable condition", () => {
	const { js } = compile(`package main
func main() {
	show := false
	gom.Mount("#app", gom.Div(gom.If(show, gom.P(gom.Text("shown")))))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app p"), null);
});

// ── Map ───────────────────────────────────────────────────────

section("gom — Map");

test("gom.Map renders a list from a slice", () => {
	const { js } = compile(`package main
func main() {
	items := []string{"x", "y", "z"}
	gom.Mount("#app", gom.Ul(gom.Map(items, func(s string) gom.Node {
		return gom.Li(gom.Text(s))
	})))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	const lis = document.querySelectorAll("#app li");
	assertEqual(lis.length, 3);
	assertEqual(lis[1].textContent, "y");
});

test("gom.Map over int slice", () => {
	const { js } = compile(`package main
func main() {
	nums := []int{1, 2, 3}
	gom.Mount("#app", gom.Ul(gom.Map(nums, func(n int) gom.Node {
		return gom.Li(gom.Text(String(n)))
	})))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	const lis = document.querySelectorAll("#app li");
	assertEqual(lis.length, 3);
	assertEqual(lis[0].textContent, "1");
	assertEqual(lis[2].textContent, "3");
});

test("gom.Map with empty slice renders no children", () => {
	const { js } = compile(`package main
func main() {
	items := []string{}
	gom.Mount("#app", gom.Ul(gom.Map(items, func(s string) gom.Node {
		return gom.Li(gom.Text(s))
	})))
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelectorAll("#app li").length, 0);
});

// ── Style ─────────────────────────────────────────────────────

section("gom — Style");

test("gom.Style injects a style element", () => {
	const { js } = compile(`package main
func main() {
	gom.MountTo("head", gom.Style("body { color: red; }"))
}`);
	const { document } = runInDom(js, "<head></head><body></body>");
	const style = document.querySelector("head style");
	assert(style !== null);
	assert(style.textContent.includes("color: red"));
});

// ── Type annotations ──────────────────────────────────────────

section("gom — type annotations");

test("gom.Node as return type compiles", () => {
	const { js, errors } = compile(`package main
func card(title string) gom.Node {
	return gom.Div(gom.Class("card"), gom.H2(gom.Text(title)))
}
func main() {
	gom.Mount("#app", card("hello"))
}`);
	assertEqual(errors.length, 0);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app h2").textContent, "hello");
});

test("gom.Node as parameter type compiles", () => {
	const { js, errors } = compile(`package main
func wrap(child gom.Node) gom.Node {
	return gom.Div(gom.Class("wrapper"), child)
}
func main() {
	gom.Mount("#app", wrap(gom.P(gom.Text("inner"))))
}`);
	assertEqual(errors.length, 0);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app .wrapper p").textContent, "inner");
});

test("variadic gom.Node parameter", () => {
	const { js, errors } = compile(`package main
func row(children ...gom.Node) gom.Node {
	return gom.Div(gom.Class("row"), children...)
}
func main() {
	gom.Mount("#app", row(gom.Span(gom.Text("a")), gom.Span(gom.Text("b"))))
}`);
	assertEqual(errors.length, 0);
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelectorAll("#app .row span").length, 2);
});

// ── MountTo ───────────────────────────────────────────────────

section("gom — MountTo");

test("gom.MountTo appends without clearing", () => {
	const { js } = compile(`package main
func main() {
	gom.MountTo("#app", gom.Span(gom.Text("added")))
}`);
	const { document } = runInDom(js, '<div id="app"><p>existing</p></div>');
	assert(document.querySelector("#app p") !== null);
	assertEqual(document.querySelector("#app span").textContent, "added");
});

// ── Re-render ─────────────────────────────────────────────────

section("gom — re-render");

test("calling Mount twice replaces content", () => {
	const { js } = compile(`package main
func render(n int) {
	gom.Mount("#app", gom.P(gom.Text(String(n))))
}
func main() {
	render(1)
	render(2)
}`);
	const { document } = runInDom(js, '<div id="app"></div>');
	const ps = document.querySelectorAll("#app p");
	assertEqual(ps.length, 1);
	assertEqual(ps[0].textContent, "2");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
