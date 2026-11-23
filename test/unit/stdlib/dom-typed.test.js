// GoFront test suite — the generated `gofront/dom` declarations
//
// `import "gofront/dom"` types the DOM: elements, events and listeners are
// checked against the declarations generated from WebIDL
// (stdlib/gofront/dom/dom.d.ts), and the declarations emit no runtime code.

import { fileURLToPath } from "node:url";
import {
	assert,
	assertEqual,
	assertErrorContains,
	compileDir,
	section,
	summarize,
	test,
	toCompileResult,
	withTempDir,
} from "../helpers.js";

// Compiles `body` (the declarations of a `package main` that imports
// `gofront/dom`) against the real stdlib.
function build(body, imports = `import "gofront/dom"`) {
	return withTempDir(
		{ "main.go": `package main\n\n${imports}\n\n${body}\n` },
		(dir) => toCompileResult(() => compileDir(dir)),
	);
}

section("gofront/dom — types");

test("Document, Element, HTMLElement, HTMLInputElement, Event and MouseEvent are declared", () => {
	const { errors } = build(`func f(
	d dom.Document,
	e dom.Element,
	h dom.HTMLElement,
	i dom.HTMLInputElement,
	ev dom.Event,
	m dom.MouseEvent,
) {
	_, _, _, _, _, _ = d, e, h, i, ev, m
}

func main() {}`);
	assertEqual(errors.length, 0);
});

test("el.(dom.HTMLInputElement).value is a string", () => {
	const { errors } = build(`func f(d dom.Document) string {
	el := d.getElementById("q")
	var s string = el.(dom.HTMLInputElement).value
	return s
}

func main() {}`);
	assertEqual(errors.length, 0);
});

test("the value of an input is not an int", () => {
	const { errors } = build(`func f(i dom.HTMLInputElement) int {
	var n int = i.value
	return n
}

func main() {}`);
	assertErrorContains(errors, "string");
});

test("a member of a base type is reached through the derived type", () => {
	const { errors } = build(`func f(i dom.HTMLInputElement) {
	i.addEventListener("input", func() {})
	_ = i.id
	_ = i.ownerDocument.title
}

func main() {}`);
	assertEqual(errors.length, 0);
});

test("a derived type is assignable to its base, not the reverse", () => {
	const ok = build(`func f(i dom.HTMLInputElement) {
	var e dom.Element = i
	_ = e
}

func main() {}`);
	assertEqual(ok.errors.length, 0);
	const bad = build(`func f(e dom.Element) {
	var i dom.HTMLInputElement = e
	_ = i
}

func main() {}`);
	assertErrorContains(bad.errors, "dom.Element");
});

test("a misspelled member is rejected", () => {
	const { errors } = build(`func f(d dom.Document) {
	_ = d.getElementByID("x")
}

func main() {}`);
	assertErrorContains(errors, "getElementByID");
});

test("a member only a specific element has needs an assertion", () => {
	const { errors } = build(`func f(d dom.Document) {
	el := d.getElementById("q")
	_ = el.value
}

func main() {}`);
	assertErrorContains(errors, "value");
});

section("gofront/dom — event listeners");

test("addEventListener takes a typed MouseEvent listener", () => {
	const { errors } = build(`func f(e dom.Element) int {
	n := 0
	e.addEventListener("click", func(ev dom.MouseEvent) {
		n = ev.clientX
	})
	return n
}

func main() {}`);
	assertEqual(errors.length, 0);
});

test("addEventListener takes a listener without parameters", () => {
	const { errors } = build(`func f(e dom.Element) {
	e.addEventListener("click", func() {})
}

func main() {}`);
	assertEqual(errors.length, 0);
});

test("addEventListener takes an Event listener", () => {
	const { errors } = build(`func f(e dom.Element) {
	e.addEventListener("input", func(ev dom.Event) { _ = ev.type })
}

func main() {}`);
	assertEqual(errors.length, 0);
});

test("addEventListener rejects a listener with an unrelated parameter", () => {
	const { errors } = build(`func f(e dom.Element) {
	e.addEventListener("click", func(n int) {})
}

func main() {}`);
	assertErrorContains(errors, "as func(dom.Event) void value");
});

test("an event target is reached through Event.target", () => {
	const { errors } = build(`func f(ev dom.Event) string {
	t := ev.target
	if t == nil {
		return ""
	}
	return t.(dom.HTMLInputElement).value
}

func main() {}`);
	assertEqual(errors.length, 0);
});

section("gofront/dom — emitted JS");

test("the typed program emits the JS of the untyped one", () => {
	const typed = build(`func read(d dom.Document, e dom.Element) string {
	e.addEventListener("click", func(ev dom.MouseEvent) { _ = ev.clientX })
	return d.getElementById("q").(dom.HTMLInputElement).value
}

func main() {
	println("ok")
}`);
	const untyped = withTempDir(
		{
			"main.go": `package main

func read(d any, e any) string {
	e.addEventListener("click", func(ev any) { _ = ev.clientX })
	return d.getElementById("q").value
}

func main() {
	println("ok")
}
`,
		},
		(dir) => toCompileResult(() => compileDir(dir)),
	);
	assertEqual(typed.errors.length, 0);
	assertEqual(untyped.errors.length, 0);
	assertEqual(typed.res.js, untyped.res.js);
});

test("the declarations emit no import and no assertion check", () => {
	const { res, errors } = build(`func f(e dom.Element) string {
	return e.(dom.HTMLInputElement).value
}

func main() {
	println("ok")
}`);
	assertEqual(errors.length, 0);
	assert(!/\bimport\b/.test(res.js), "emitted an import");
	assert(!res.js.includes("gofront/dom"), "mentions the package");
	assert(!/instanceof|typeof/.test(res.js), "emitted a runtime check");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
