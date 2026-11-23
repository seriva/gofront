// GoFront test suite — typed browser globals
//
// `document`, `window`, `fetch` and the other Web API globals are typed from
// the generated `gofront/*` declarations, so their member chains are checked.
// The ECMAScript built-ins (`Math`, `JSON`, ...) are not defined in WebIDL and
// stay JS-dynamic.

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	declarationStats,
	loadDeclarationPackage,
} from "../../../src/resolver.js";
import { TypeChecker } from "../../../src/typechecker/index.js";
import {
	anyKind,
	BROWSER_GLOBALS,
	ES_BUILTIN_GLOBALS,
} from "../../../src/typechecker/types.js";
import {
	assert,
	assertEqual,
	assertErrorContains,
	compile,
	compileDir,
	section,
	summarize,
	test,
	toCompileResult,
	withTempDir,
} from "../helpers.js";

const body = (src) => `package main\n\n${src}\n`;

section("Typed browser globals — reads");

test("document.getElementById is typed", () => {
	const { errors } = compile(
		body(`func main() {
	var id string = document.getElementById("x").id
	_ = id
}`),
	);
	assertEqual(errors.length, 0);
});

test("a member the element type lacks needs an assertion first", () => {
	const { errors } = compile(
		body(`func main() {
	_ = document.getElementById("x").value
}`),
	);
	assertErrorContains(errors, "No member 'value'");
});

test("an assertion to a declared element type reads its members", () => {
	const { errors } = compile(
		body(`import "gofront/dom"

func main() {
	var v string = document.getElementById("x").(dom.HTMLInputElement).value
	_ = v
}`),
	);
	assertEqual(errors.length, 0);
});

test("a misspelled member is rejected", () => {
	const { errors } = compile(
		body(`func main() {
	_ = document.getElementByID("x")
}`),
	);
	assertErrorContains(errors, "No member 'getElementByID'");
});

test("a misspelled member of a global function result is rejected", () => {
	const { errors } = compile(
		body(`async func main() {
	resp := await fetch("/x")
	_ = resp.okay
}`),
	);
	assertErrorContains(errors, "No member 'okay'");
});

test("await fetch(url) is a fetch.Response", () => {
	const { errors } = compile(
		body(`import "gofront/fetch"

async func main() {
	resp := await fetch("/x")
	var r fetch.Response = resp
	var ok bool = resp.ok
	var text string = await resp.text()
	_, _, _ = r, ok, text
}`),
	);
	assertEqual(errors.length, 0);
});

test("a window is comparable to nil", () => {
	const { errors } = compile(
		body(`func main() {
	if window == nil {
		println("no window")
	}
	if document == nil {
		println("no document")
	}
}`),
	);
	assertEqual(errors.length, 0);
});

test("window.innerWidth is an int", () => {
	const { errors } = compile(
		body(`func main() {
	var w int = window.innerWidth
	_ = w
}`),
	);
	assertEqual(errors.length, 0);
});

test("window.innerWidth is not a float64", () => {
	const { errors } = compile(
		body(`func main() {
	var f float64 = window.innerWidth
	_ = f
}`),
	);
	assertErrorContains(errors, "cannot use");
});

test("window.innerWidth * 0.5 is rejected", () => {
	const { errors } = compile(
		body(`func main() {
	_ = window.innerWidth * 0.5
}`),
	);
	assertErrorContains(errors, "0.5");
});

test("a global function checks its arguments", () => {
	const { errors } = compile(
		body(`func main() {
	setTimeout(func() {}, "soon")
}`),
	);
	assertErrorContains(errors, "cannot use");
});

test("a Go function is a timer or animation frame callback", () => {
	const { js, errors } = compile(
		body(`func tick(t float64) { requestAnimationFrame(tick) }

func main() {
	id := setTimeout(func() {}, 10)
	clearTimeout(id)
	requestAnimationFrame(tick)
}`),
	);
	assertEqual(errors.length, 0);
	assert(!js.includes("__ity"), "tagged a callback handed to the browser");
});

test("a localStorage read compares to nil and works as a string", () => {
	const { errors } = compile(
		body(`import "strings"

func main() {
	raw := localStorage.getItem("todos")
	if raw == nil {
		return
	}
	_ = strings.TrimSpace(raw)
}`),
	);
	assertEqual(errors.length, 0);
});

test("a typed global is emitted as the global itself", () => {
	const { js, errors } = compile(
		body(`func main() {
	el := document.getElementById("x")
	el.textContent = "hi"
	window.addEventListener("resize", func() {})
}`),
	);
	assertEqual(errors.length, 0);
	assert(js.includes('document.getElementById("x")'), js);
	assert(!/\bimport\b/.test(js), "emitted an import");
});

section("Typed browser globals — ECMAScript built-ins stay dynamic");

test("JSON.stringify and arithmetic on Math.random() stay permissive", () => {
	const { errors } = compile(
		body(`func main() {
	s := JSON.stringify([]int{1})
	x := Math.random() * 2
	var n int = JSON.parse("1")
	_, _, _ = s, x, n
}`),
	);
	assertEqual(errors.length, 0);
});

test("a named basic value reaches console.log as itself", () => {
	const { js, errors } = compile(
		body(`type Level int

func main() {
	console.log(Level(1))
}`),
	);
	assertEqual(errors.length, 0);
	assert(js.includes("console.log(1)"), js);
});

test("a struct value is not boxed as a Go interface value for a browser call", () => {
	const { js, errors } = compile(
		body(`type P struct{ X int }

func main() {
	p := P{X: 1}
	console.log(p)
}`),
	);
	assertEqual(errors.length, 0);
	assert(js.includes("console.log(p"), js);
	assert(!js.includes("__ifv"), "boxed a value handed to the browser");
});

section("Typed browser globals — table");

// A checker whose declaration loader reads the real stdlib.
function webChecker() {
	const checker = new TypeChecker();
	checker.setDeclarationLoader((name) => loadDeclarationPackage(name));
	return checker;
}

test("no WebIDL-defined browser global is a plain any", () => {
	const checker = webChecker();
	const untyped = [...BROWSER_GLOBALS].filter(
		(g) => !ES_BUILTIN_GLOBALS.has(g) && anyKind(checker.universe.lookup(g)),
	);
	assertEqual(untyped.join(","), "");
});

test("the ECMAScript built-ins are the 18 globals that stay any", () => {
	const checker = webChecker();
	assertEqual(ES_BUILTIN_GLOBALS.size, 18);
	for (const g of ES_BUILTIN_GLOBALS) {
		assert(BROWSER_GLOBALS.has(g), `${g} is not a browser global`);
		assertEqual(anyKind(checker.universe.lookup(g)), "dynamic");
	}
});

section("Typed browser globals — loading");

// A stdlib tree whose `dom` declares just the types the globals below read.
const FIXTURE_DOM = `interface Window {
	readonly document: Document;
	readonly innerWidth: int;
}
interface Document {
	readonly title: string;
}
`;

function loaded(src) {
	return withTempDir(
		{
			"stdlib/gofront/dom/dom.d.ts": FIXTURE_DOM,
			"app/main.go": src,
		},
		(dir) => {
			const before = declarationStats.parsed;
			const out = toCompileResult(() =>
				compileDir(join(dir, "app"), { stdlibRoot: join(dir, "stdlib") }),
			);
			return { ...out, parsed: declarationStats.parsed - before };
		},
	);
}

test("a println-only program loads no declaration file", () => {
	const { errors, parsed } = loaded(
		body(`func main() {
	println("ok")
}`),
	);
	assertEqual(errors.length, 0);
	assertEqual(parsed, 0);
});

test("a program that reads a typed global loads the declarations once", () => {
	const { errors, parsed } = loaded(
		body(`func main() {
	var t string = document.title
	var w int = window.innerWidth
	_, _ = t, w
}`),
	);
	assertEqual(errors.length, 0);
	assertEqual(parsed, 1);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
