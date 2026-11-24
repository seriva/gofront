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
	assertContains,
	assertEqual,
	assertErrorContains,
	compile,
	compileDir,
	runJs,
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

section("Typed browser globals — operations on resolved values");

for (const [name, op, want] of [
	["indexing", "_ = el[0]", "Cannot index type dom.Element"],
	["slicing", "_ = el[0:1]", "Cannot slice type dom.Element"],
	["calling", "el()", "Cannot call non-function type dom.Element"],
	["ranging", "for range el {}", "cannot range over el"],
	["testing", "if el {}", "non-boolean condition"],
]) {
	test(`${name} an element read from a call is rejected`, () => {
		const { errors } = compile(
			body(`import "gofront/dom"

func main() {
	el := document.getElementById("x")
	${op}
}`),
		);
		assertErrorContains(errors, want);
	});
}

test("ranging over an element or a collection parameter is rejected", () => {
	const { errors } = compile(
		body(`import "gofront/dom"

func f(el dom.Element) {
	for range el {}
}

func g(ch dom.HTMLCollection) {
	for range ch {}
}`),
	);
	assertErrorContains(errors, "cannot range over el");
	assertErrorContains(errors, "cannot range over ch");
});

test("a slice of browser values typed through a member is that type's slice", () => {
	const { errors } = compile(
		body(`import "gofront/dom"

func f(n dom.NotRestoredReasons) {
	var xs []dom.NotRestoredReasons = n.children
	_ = xs
}`),
	);
	assertEqual(errors.length, 0);
});

test("a member of an element read from a call is still read", () => {
	const { errors } = compile(
		body(`func main() {
	el := document.getElementById("x")
	var id string = el.id
	_ = id
}`),
	);
	assertEqual(errors.length, 0);
});

section("Typed browser globals — operators");

const OPS_PRELUDE = `import "gofront/dom"

func f(w dom.Window, w2 dom.Window, e dom.Element, n dom.Node, d dom.Document) {`;

for (const [op, want] of [
	["_ = window + 1", "mismatched types dom.Window and untyped int"],
	["_ = w + 1", "mismatched types dom.Window and untyped int"],
	["w += 1", "mismatched types dom.Window and untyped int"],
	["_ = w + w", "operator + not defined on w"],
	["_ = w - 1", "mismatched types dom.Window and untyped int"],
	["_ = w * 2", "mismatched types dom.Window and untyped int"],
	["_ = w < w", "operator < not defined on dom.Window"],
	["_ = w == 1", "mismatched types dom.Window and untyped int"],
	["_ = 1 == w", "mismatched types untyped int and dom.Window"],
	['_ = w == "x"', "mismatched types dom.Window and untyped string"],
	["_ = w && true", "mismatched types dom.Window and untyped bool"],
	["_ = w || false", "mismatched types dom.Window and untyped bool"],
	["_ = !w", "operator ! not defined on w"],
	["_ = -w", "operator - not defined on w"],
	["_ = +w", "operator + not defined on w"],
	["_ = ^w", "operator ^ not defined on w"],
	["_ = w == d", "mismatched types dom.Window and dom.Document"],
]) {
	test(`${op} on a browser value is rejected`, () => {
		const { errors } = compile(
			body(`${OPS_PRELUDE}
	${op}
}`),
		);
		assertErrorContains(errors, "invalid operation");
		assertErrorContains(errors, want);
		assertEqual(errors.length, 1);
	});
}

test("the window global is not a number", () => {
	const { errors } = compile(
		body(`func main() {
	_ = window + 1
}`),
	);
	assertErrorContains(errors, "mismatched types dom.Window and untyped int");
});

test("a browser value still compares by reference and against nil", () => {
	const { errors } = compile(
		body(`${OPS_PRELUDE}
	_ = w == nil
	_ = w != nil
	_ = nil == w
	_ = w == w2
	_ = e == n
	_ = n != e
	if window == nil {
		return
	}
}

func g(a dom.Element, b dom.Element) bool { return a == b }`),
	);
	assertEqual(errors.map((e) => e.message).join(), "");
});

test("a browser value keeps its other operator errors", () => {
	const { errors } = compile(
		body(`${OPS_PRELUDE}
	_ = w << 1
	_ = 1 << w
	w++
	switch w {
	case 1:
	}
}

func g(k map[dom.Element]int) {}`),
	);
	assertErrorContains(errors, "shifted operand w");
	assertErrorContains(errors, "invalid shift count");
	assertErrorContains(errors, "non-numeric type dom.Window");
	assertErrorContains(errors, "cannot convert 1");
	assertEqual(errors.length, 4);
});

section("Typed browser globals — stored function values");

const compiled = (src) => {
	const { js, errors } = compile(body(src));
	assertEqual(errors.map((e) => e.message).join(), "");
	return js;
};

const absent = (js, text) =>
	assert(!js.includes(text), `unexpected ${text} in the output`);

test("a stored browser function binds its receiver and copies nothing", () => {
	const js = compiled(`type P struct{ X int }

func main() {
	p := P{1}
	arr := [2]int{1, 2}
	fn := console.log
	fn(p)
	fn(arr)
}`);
	assertContains(js, "console.log?.bind(console)");
	assertContains(js, "fn(p);");
	assertContains(js, "fn(arr);");
	absent(js, "p.__clone()");
	absent(js, "arr?.slice()");
});

test("a stored browser function spreads a slice as a JavaScript spread", () => {
	const js = compiled(`func main() {
	fn := console.log
	xs := []any{1, 2}
	fn(xs...)
}`);
	assertContains(js, "fn(...xs)");
	absent(js, "__sp");
});

test("a stored browser method keeps its receiver and takes any argument count", () => {
	const js = compiled(`func main() {
	st := window.setTimeout
	st(func() {}, 10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
	ce := document.createElement
	el := ce("div")
	println(el.tagName)
}`);
	absent(js, "too many arguments");
	const out = runJs(js, {
		window: { setTimeout() {} },
		document: {
			createElement(tag) {
				if (this?.tag !== "doc") throw new Error("lost receiver");
				return { tagName: tag };
			},
			tag: "doc",
		},
	});
	assertEqual(out, "div");
});

test("a method value of a browser object evaluates its receiver once", () => {
	const js = compiled(`func main() {
	fn := document.getElementById("a").getAttribute
	println(fn("k"))
}`);
	const looked = [];
	const out = runJs(js, {
		document: {
			getElementById(id) {
				looked.push(id);
				return {
					id,
					getAttribute(name) {
						return `${this.id}-${name}`;
					},
				};
			},
		},
	});
	assertEqual(looked.join(), "a");
	assertEqual(out, "a-k");
});

test("a nil check of a missing browser method still reads the property", () => {
	const js = compiled(`func main() {
	println(window.matchMedia != nil)
}`);
	assertEqual(runJs(js, { window: {} }), "false");
	assertEqual(runJs(js, { window: { matchMedia() {} } }), "true");
});

test("a Go variadic function value keeps its interface boxing", () => {
	const js = compiled(`type P struct{ X int }

func keep(xs ...any) {}

func main() {
	p := P{1}
	k := keep
	k(p)
	var g func(...any) = console.log
	g(p)
	console.log(p)
}`);
	assertContains(js, "k(__ifv(p));");
	assertContains(js, "g(__ifv(p));");
	assertContains(js, "console.log(p);");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
