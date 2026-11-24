// GoFront test suite — `gofront/*` declaration packages
//
// The typed web packages (`gofront/dom`, `gofront/webgpu`, ...) are `.d.ts`
// declarations the compiler loads on demand. Each package keeps its own type
// table: `dom.T` is reached through the package qualifier, a bare `T` stays
// free for the user's own type, and one package names another's types by
// qualified name.

import { readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Lexer } from "../../../src/lexer/lexer.js";
import { PackageCache } from "../../../src/link/package-cache.js";
import { Parser } from "../../../src/parser/index.js";
import { declarationStats } from "../../../src/resolver.js";
import { TypeChecker } from "../../../src/typechecker/index.js";
import {
	assert,
	assertEqual,
	assertErrorContains,
	compileDir,
	parseDeclarationPackage,
	runJs,
	section,
	summarize,
	test,
	toCompileResult,
	withTempDir,
} from "../helpers.js";

const DOM = `
interface EventTarget { addEventListener(type: string, cb: (e: Event) => void): void; }
interface Event { target: EventTarget | null; type: string; }
interface Node extends EventTarget { parentNode: Node | null; childNodes: Node[]; }
interface Element extends Node { id: string; ownerDocument: Document; }
interface HTMLInputElement extends Element { value: string; }
interface Document extends Node { documentElement: Element; getElementById(id: string): Element | null; }
declare var document: Document;
declare function requestIdleCallback(cb: () => void): int;
`;

const WEBGPU = `
/// <reference types="gofront/dom" />
interface Buffer { size: int; label: string; }
interface Texture { width: int; createView(): TextureView; }
interface TextureView { label: string; }
/** @dictionary */
interface BufferDescriptor { size: int; label?: string; }
interface Device extends dom.EventTarget {
	queue: Queue;
	lost: Promise<DeviceLostInfo>;
	canvas: dom.Element | null;
	createBuffer(d: BufferDescriptor): Buffer;
	createTexture(): Texture;
}
interface Queue { submit(): void; }
interface DeviceLostInfo { reason: string; }
`;

const domPkg = () => parseDeclarationPackage(DOM, "dom");
const gpuPkg = () => parseDeclarationPackage(WEBGPU, "webgpu");

function parseFile(name, source) {
	const ast = new Parser(
		new Lexer(source, name).tokenize(),
		name,
		source,
	).parse();
	ast._source = source;
	return ast;
}

// Checks `source` (a `package main` body) with the packages in `pkgs`
// registered and bound under their own names. Returns { errors, checker }.
function check(source, pkgs = [domPkg(), gpuPkg()], bind = true) {
	const checker = new TypeChecker();
	const file = parseFile("main.go", `package main\n${source}`);
	for (const pkg of pkgs) {
		if (bind) checker.bindDeclarationPackage(pkg, pkg.name, "main.go");
		else checker.addDeclarationPackage(pkg);
	}
	const errors = checker.checkAll([file]);
	return { errors, checker };
}

section("Declaration packages — scoped type tables");

test("a registered package exposes its types through the qualifier", () => {
	const { errors } =
		check(`func f(e dom.Element, i dom.HTMLInputElement) string {
	_ = e.id
	return i.value
}`);
	assertEqual(errors.length, 0);
});

test("a package's bare type names stay out of the global type table", () => {
	const { checker, errors } = check("func f(b webgpu.Buffer) {}");
	assertEqual(errors.length, 0);
	for (const bare of ["Buffer", "Texture", "Device", "Element", "Event"])
		assert(!checker.types.has(bare), `bare '${bare}' leaked`);
	assert(checker.types.has("webgpu.Buffer"));
	assert(checker.types.has("dom.Element"));
});

test("a user type named like a package type does not collide", () => {
	const { errors } = check(`type Buffer struct{ n int }

func f(b webgpu.Buffer, u Buffer) int {
	return int(b.size) + u.n
}`);
	assertEqual(errors.length, 0);
});

test("a user type named like a package type keeps its own members", () => {
	const { errors } = check(`type Buffer struct{ n int }

func f(u Buffer) int { return u.size }`);
	assertErrorContains(errors, "size");
});

test("an unbound package qualifier is undefined", () => {
	const { errors } = check("func f(b webgpu.Buffer) {}", [gpuPkg()], false);
	assertErrorContains(errors, "webgpu");
	assertEqual(errors.length, 1);
});

test("a package bound in one file does not bind another", () => {
	const checker = new TypeChecker();
	const a = parseFile("a.go", "package main\nfunc A(e dom.Element) {}");
	const b = parseFile("b.go", "package main\nfunc B(e dom.Element) {}");
	checker.bindDeclarationPackage(domPkg(), "dom", "a.go");
	const errors = checker.checkAll([a, b]);
	assertErrorContains(errors, "dom.Element");
	assertEqual(errors.length, 1);
});

test("a package bound under an alias uses the alias", () => {
	const checker = new TypeChecker();
	const file = parseFile(
		"main.go",
		"package main\nfunc f(e d.Element) string { return e.id }",
	);
	checker.bindDeclarationPackage(domPkg(), "d", "main.go");
	assertEqual(checker.checkAll([file]).length, 0);
});

test("a registered package is registered once per checker", () => {
	const checker = new TypeChecker();
	const pkg = domPkg();
	const key = pkg.keys.get("Element");
	checker.addDeclarationPackage(pkg);
	const element = checker.types.get(key);
	assert(element, "registered under its key");
	assert(!checker.types.has("dom.Element"), "registered under the qualifier");
	checker.addDeclarationPackage(pkg);
	checker.bindDeclarationPackage(pkg, "dom", "main.go");
	assert(checker.types.get(key) === element);
});

section("Declaration packages — references inside a package");

test("a member type names another type of its package", () => {
	const { errors } = check(`func f(d dom.Document) string {
	var e dom.Element = d.documentElement
	var doc dom.Document = e.ownerDocument
	_ = doc
	return e.id
}`);
	assertEqual(errors.length, 0);
});

test("a member type resolves through slices and nullable unions", () => {
	const { errors } = check(`func f(n dom.Node) {
	kids := n.childNodes
	var first dom.Node = kids[0]
	p := n.parentNode
	if p == nil {
		_ = first
	}
}`);
	assertEqual(errors.length, 0);
});

test("a member type is checked against its package type", () => {
	const { errors } = check(`func f(d dom.Document) {
	var b webgpu.Buffer = d.documentElement
	_ = b
}`);
	assertErrorContains(errors, "(value of type dom.Element) as webgpu.Buffer");
});

test("a function result resolves in its package", () => {
	const { errors } = check(`func f(d dom.Document) string {
	e := d.getElementById("x")
	if e == nil {
		return ""
	}
	return e.id
}`);
	assertEqual(errors.length, 0);
});

test("a method of a package type takes a package type argument", () => {
	const { errors } = check(`func f(d webgpu.Device) {
	d.createBuffer(map[string]any{"size": 4})
	var q webgpu.Queue = d.queue
	q.submit()
}`);
	assertEqual(errors.length, 0);
});

test("a misspelled member of a package type is rejected", () => {
	const { errors } = check(`func f(e dom.Element) string { return e.idd }`);
	assertErrorContains(errors, "idd");
});

test("a package value is a member of the qualifier", () => {
	const { errors } = check(`func f() string {
	return dom.document.documentElement.id
}`);
	assertEqual(errors.length, 0);
});

section("Declaration packages — cross-package references");

test("a qualified reference names a type of another package", () => {
	const { errors } = check(`func f(d webgpu.Device) {
	var e dom.Element = d.canvas
	_ = e
}`);
	assertEqual(errors.length, 0);
});

test("extends reaches a base declared in another package", () => {
	const { errors } = check(`func f(d webgpu.Device) {
	d.addEventListener("uncapturederror", func(e dom.Event) {})
}`);
	assertEqual(errors.length, 0);
});

test("a type extending another package's type is assignable to it", () => {
	const { errors } = check(`func f(d webgpu.Device) {
	var t dom.EventTarget = d
	_ = t
}`);
	assertEqual(errors.length, 0);
});

test("a base type is not assignable to the package type that extends it", () => {
	const { errors } = check(`func f(t dom.EventTarget) {
	var d webgpu.Device = t
	_ = d
}`);
	assertErrorContains(errors, "cannot use");
});

test("an assertion to a package type passes the value through", () => {
	const { errors, checker } =
		check(`func f(raw any, t dom.EventTarget, e dom.Element) {
	d := raw.(webgpu.Device)
	_ = d.queue
	i := e.(dom.HTMLInputElement)
	_ = i.value
	g := t.(webgpu.Device)
	_ = g.queue
}`);
	assertEqual(errors.length, 0);
	assert(checker.types.has("webgpu.Device"));
});

test("a Promise member of a package type awaits to its package type", () => {
	const { errors } = check(`func f(d webgpu.Device) string {
	info := await d.lost
	return info.reason
}`);
	assertEqual(errors.length, 0);
});

test("a reference to a package that is not registered stays untyped", () => {
	const { errors } = check(
		`func f(d webgpu.Device) {
	_ = d.canvas.anything
}`,
		[gpuPkg()],
	);
	assertEqual(errors.length, 0);
});

section("Declaration packages — import and lazy loading");

// A stdlib tree holding the fixture packages, and a program importing them.
const STDLIB = {
	"stdlib/gofront/dom/dom.d.ts": DOM,
	"stdlib/gofront/webgpu/webgpu.d.ts": WEBGPU,
};
const STDLIB_FILES = STDLIB;

// Compiles `main` (a package main file) against the fixture stdlib; `extra`
// adds files. Returns the compile result and the declaration files parsed.
function build(main, { extra = {}, stdlib = STDLIB, target } = {}) {
	return withTempDir({ ...stdlib, "app/main.go": main, ...extra }, (dir) => {
		const before = declarationStats.parsed;
		const out = toCompileResult(() =>
			compileDir(join(dir, "app"), {
				stdlibRoot: join(dir, "stdlib"),
				...(target ? { target } : {}),
			}),
		);
		return { ...out, parsed: declarationStats.parsed - before };
	});
}

const USES_DOM = `package main

import "gofront/dom"

func name(e dom.Element) string { return e.id }

func main() {
	println("ok")
}
`;

test('import "gofront/dom" binds the package\'s types', () => {
	const { errors } = build(USES_DOM);
	assertEqual(errors.length, 0);
});

test("a declaration import emits no runtime code", () => {
	const { res } = build(USES_DOM);
	assert(!/\bimport\b/.test(res.js), "emitted an import");
	assert(!res.js.includes("gofront/dom"), "mentions the package");
	assert(!/\bdom\b/.test(res.js), "emitted the qualifier");
});

test("a declaration import emits the JS of the untyped program", () => {
	const typed = build(`package main

import "gofront/dom"

func id(e dom.Element) dom.Element { return e }

func main() {
	var e dom.Element
	id(e)
	println("ok")
}
`);
	const untyped = build(`package main

func id(e any) any { return e }

func main() {
	var e any
	id(e)
	println("ok")
}
`);
	assertEqual(typed.res.js, untyped.res.js);
});

test("an assertion to a package type emits no runtime check", () => {
	const { res, errors } = build(`package main

import "gofront/dom"

func main() {
	var e dom.Element
	i := e.(dom.HTMLInputElement)
	println(i.value)
}
`);
	assertEqual(errors.length, 0);
	assert(!res.js.includes("HTMLInputElement"), "emitted the type");
});

test("a package value is emitted as the JS global it declares", () => {
	const { res, errors } = build(`package main

import "gofront/dom"

func main() {
	println(dom.document.documentElement.id)
	dom.requestIdleCallback(func() {})
}
`);
	assertEqual(errors.length, 0);
	assert(res.js.includes("document.documentElement.id"), res.js);
	assert(res.js.includes("requestIdleCallback("), res.js);
	assert(!/\bdom\./.test(res.js), "emitted the qualifier");
});

test("an unused declaration import is reported", () => {
	const { errors } = build(`package main

import "gofront/dom"

func main() { println("x") }
`);
	assertErrorContains(errors, "'dom' imported and not used");
});

test("a declaration import can take an alias", () => {
	const { errors } = build(`package main

import d "gofront/dom"

func main() {
	var e d.Element
	println(e == nil)
}
`);
	assertEqual(errors.length, 0);
});

test("a declaration package is parsed once and only when used", () => {
	const root = {
		"stdlib/gofront/dom/dom.d.ts": DOM,
		"stdlib/gofront/webgpu/webgpu.d.ts": WEBGPU,
	};
	withTempDir(
		{ ...root, "app/main.go": USES_DOM, "other/main.go": USES_DOM },
		(dir) => {
			const options = { stdlibRoot: join(dir, "stdlib") };
			const before = declarationStats.parsed;
			compileDir(join(dir, "app"), options);
			compileDir(join(dir, "other"), options);
			compileDir(join(dir, "app"), options);
			assertEqual(declarationStats.parsed - before, 1);
		},
	);
});

test("a program that uses no web package loads no declaration file", () => {
	const { errors, parsed } = build(`package main

func main() { println("hi") }
`);
	assertEqual(errors.length, 0);
	assertEqual(parsed, 0);
});

test("a package that references another loads both", () => {
	const { errors, parsed } = build(`package main

import "gofront/webgpu"

func use(d webgpu.Device) {
	d.addEventListener("x", func(e any) {})
	_ = d.canvas.id
}

func main() {
	var d webgpu.Device
	use(d)
}
`);
	assertEqual(errors.length, 0);
	assertEqual(parsed, 2);
});

test("a declaration import from a wasm package is rejected", () => {
	const { errors } = build(
		`//gofront:target wasm
package main

import "gofront/dom"

func main() { var e dom.Element; println(e == nil) }
`,
	);
	assertErrorContains(errors, "'gofront/dom' is only available in js packages");
});

test("a declaration import from a both package is rejected", () => {
	const { errors } = build(
		`//gofront:target both
package main

import "gofront/dom"

func main() { var e dom.Element; println(e == nil) }
`,
	);
	assertErrorContains(errors, "'gofront/dom' is only available in js packages");
});

test("an unknown gofront package is an unsupported-package error", () => {
	const { errors } = build(`package main

import "gofront/unknown"

func main() { println(unknown.X) }
`);
	assertErrorContains(errors, "unsupported package 'gofront/unknown'");
});

test("an unknown gofront package is rejected in a wasm package", () => {
	const { errors } = build(
		`//gofront:target wasm
package main

import "gofront/unknown"

func main() { println(unknown.X) }
`,
	);
	assertErrorContains(errors, "unsupported package 'gofront/unknown'");
});

test("a package missing from the stdlib tree is unsupported", () => {
	const { errors } = build(USES_DOM, { stdlib: {} });
	assertErrorContains(errors, "unsupported package 'gofront/dom'");
});

test("an unknown gofront package is not an untyped npm import", () => {
	const warn = console.error;
	const seen = [];
	console.error = (...a) => seen.push(a.join(" "));
	try {
		build(`package main

import "gofront/unknown"

func main() {}
`);
	} finally {
		console.error = warn;
	}
	assert(!seen.some((m) => m.includes("cannot find types")), seen.join("\n"));
});

test("gofront/shared is still a built-in package", () => {
	const { errors } = build(`//gofront:target wasm
package main

import "gofront/shared"

func main() { println(1) }
`);
	assert(!errors.some((e) => e.message.includes("unsupported package")));
});

section("Declaration packages — same-named types and local packages");

test("same-named types of two packages are different types", () => {
	const p1 = parseDeclarationPackage("interface Buffer { n: int; }", "p1");
	const p2 = parseDeclarationPackage("interface Buffer { n: int; }", "p2");
	const { errors } = check(
		`func takeP1(b p1.Buffer) {}

func f(b p2.Buffer) { takeP1(b) }`,
		[p1, p2],
	);
	assertErrorContains(errors, "p2.Buffer");
});

test("a consumer .d.ts type is not a package type of the same name", () => {
	withTempDir(
		{
			...STDLIB_FILES,
			"app/custom.d.ts": "export interface Element { custom: number; }\n",
			"app/main.go": `package main

import (
	"gofront/dom"
	"js:./custom.d.ts"
)

func f(e dom.Element) {
	var c Element = e
	_ = c
}

func main() {}
`,
		},
		(dir) => {
			const { errors } = toCompileResult(() =>
				compileDir(join(dir, "app"), { stdlibRoot: join(dir, "stdlib") }),
			);
			assertErrorContains(errors, "cannot use");
		},
	);
});

test("a local package named like a declaration package keeps inheritance", () => {
	const { errors } = build(
		`package main

import (
	"./dom"
	"gofront/webgpu"
)

func use(d webgpu.Device, e dom.EventTarget) {
	d.addEventListener("x", func(e any) {})
	_ = e.Custom
}

func main() {}
`,
		{
			extra: {
				"app/dom/dom.go": `package dom

type EventTarget struct{ Custom int }
`,
			},
		},
	);
	assertEqual(errors.length, 0);
});

test("a local package aliased like a declaration package keeps inheritance", () => {
	const { errors } = build(
		`package main

import (
	dom "./helper"
	"gofront/webgpu"
)

func use(d webgpu.Device, e dom.EventTarget) {
	d.addEventListener("x", func(e any) {})
	_ = e.Custom
}

func main() {}
`,
		{
			extra: {
				"app/helper/helper.go": `package helper

type EventTarget struct{ Custom int }
`,
			},
		},
	);
	assertEqual(errors.length, 0);
});

test("an edited declaration file is read again by a cached build", () => {
	const stdlib = join("stdlib", "gofront", "dom", "dom.d.ts");
	const files = {
		[stdlib]: "interface Element { id: string; }\n",
		"app/main.go": `package main

import "gofront/dom"

func name(e dom.Element) string { return e.id }

func main() {}
`,
	};
	withTempDir(files, (dir) => {
		const options = {
			stdlibRoot: join(dir, "stdlib"),
			packageCache: new PackageCache(),
		};
		const first = toCompileResult(() => compileDir(join(dir, "app"), options));
		assertEqual(first.errors.length, 0);
		const path = join(dir, stdlib);
		writeFileSync(path, "interface Element { nope: int; }\n");
		const later = new Date(Date.now() + 60000);
		utimesSync(path, later, later);
		const second = toCompileResult(() => compileDir(join(dir, "app"), options));
		assertErrorContains(second.errors, "id");
	});
});

// Compiles `app` on one cache, rewrites the declaration file `rel` of the
// temporary stdlib with a newer modification time, and compiles again.
function recompileAfterEdit(files, rel, from, to) {
	let out;
	withTempDir(files, (dir) => {
		const options = {
			stdlibRoot: join(dir, "stdlib"),
			packageCache: new PackageCache(),
		};
		const first = compileDir(join(dir, "app"), options);
		const path = join(dir, rel);
		writeFileSync(path, readFileSync(path, "utf8").replace(from, to));
		const later = new Date(Date.now() + 60000);
		utimesSync(path, later, later);
		const second = toCompileResult(() => compileDir(join(dir, "app"), options));
		out = { first, second };
	});
	return out;
}

const GLOBAL_DOM = join("stdlib", "gofront", "dom", "dom.d.ts");
const READS_TITLE = `package main

func main() {
	var s string = document.title
	_ = s
}
`;

test("an edited declaration read as a browser global is read again by a cached build", () => {
	const { first, second } = recompileAfterEdit(
		{
			[GLOBAL_DOM]:
				"interface Document { title: string; }\ninterface Window { document: Document; }\n",
			"app/main.go": READS_TITLE,
		},
		GLOBAL_DOM,
		"title: string",
		"title: int",
	);
	assert(
		first.watchedFiles.some((f) => f.endsWith("dom.d.ts")),
		"the declaration file is watched",
	);
	assertErrorContains(second.errors, "cannot use");
});

test("a declaration a browser global's package references is part of the cache key", () => {
	const fetchDts = join("stdlib", "gofront", "fetch", "fetch.d.ts");
	const { first, second } = recompileAfterEdit(
		{
			[GLOBAL_DOM]: `/// <reference types="gofront/fetch" />
interface Document { title: fetch.Title; }
interface Window { document: Document; }
`,
			[fetchDts]: "interface Title { text: string; }\n",
			"app/main.go": `package main

func main() {
	var s string = document.title.text
	_ = s
}
`,
		},
		fetchDts,
		"text: string",
		"text: int",
	);
	assert(
		first.watchedFiles.some((f) => f.endsWith("fetch.d.ts")),
		"the referenced declaration file is watched",
	);
	assertErrorContains(second.errors, "cannot use");
});

test("a stdlib package reading a browser global is rebuilt when its declaration changes", () => {
	const { second } = recompileAfterEdit(
		{
			[GLOBAL_DOM]:
				"interface Document { title: string; }\ninterface Window { document: Document; }\n",
			"stdlib/pg/pg.go": `//gofront:target js

package pg

func Title() string { return document.title }
`,
			"app/main.go": `package main

import "pg"

func main() { println(pg.Title()) }
`,
		},
		GLOBAL_DOM,
		"title: string",
		"title: int",
	);
	assertErrorContains(second.errors, "cannot use");
});

test("a program that reads no browser global loads no declaration file", () => {
	withTempDir(
		{
			"stdlib/gofront/dom/dom.d.ts": DOM,
			"app/main.go": "package main\nfunc main() { println(1) }\n",
		},
		(dir) => {
			const res = compileDir(join(dir, "app"), {
				stdlibRoot: join(dir, "stdlib"),
				packageCache: new PackageCache(),
			});
			assertEqual(res.watchedFiles.length, 0);
		},
	);
});

test("a deferred method of a declaration value keeps the receiver it had at the defer", () => {
	const { res, errors } = build(
		`package main

import "gofront/dom"

func main() {
	el := document.getElementById("a").(dom.Field)
	defer el.focus()
	el = document.getElementById("b").(dom.Field)
	println(el.id)
}
`,
		{
			stdlib: {
				"stdlib/gofront/dom/dom.d.ts": `interface Element { id: string; }
interface Field extends Element { focus(): void; }
interface Document { getElementById(id: string): Element | null; }
interface Window { document: Document; }
`,
			},
		},
	);
	assertEqual(errors.length, 0);
	const focused = [];
	const out = runJs(res.js, {
		document: {
			getElementById: (id) => ({ id, focus: () => focused.push(id) }),
		},
	});
	assertEqual(out, "b");
	assertEqual(focused.join(), "a");
});

test("a struct or array passed to a typed browser call is not copied", () => {
	const { res, errors } = build(
		`package main

import "gofront/dom"

type P struct{ X int }

func keep(ps ...P) {}

func main() {
	p := P{X: 1}
	a := [2]int{1, 2}
	console.log(p, a)
	alert(p)
	var t dom.Tokens
	t.add(p, a)
	keep(p)
}
`,
		{
			stdlib: {
				"stdlib/gofront/dom/dom.d.ts": `interface Console { log(...data: any[]): void; }
interface Tokens { add(...tokens: any[]): void; }
interface Window { alert(...data: any[]): void; }
`,
			},
		},
	);
	assertEqual(errors.map((e) => e.message).join(), "");
	const calls = res.js.match(/\b(console\.log|alert|t\.add|keep)\(.*\);/g);
	assertEqual(calls.length, 4);
	for (const call of calls.slice(0, 3))
		assert(
			!/__clone|slice\(\)/.test(call),
			`a typed browser call copied its argument: ${call}`,
		);
	assert(
		calls[3].includes("__clone"),
		"a Go variadic callee still gets a copy",
	);
});

test("an unchanged declaration file is still parsed once", () => {
	withTempDir(
		{
			"stdlib/gofront/dom/dom.d.ts": DOM,
			"stdlib/gofront/webgpu/webgpu.d.ts": WEBGPU,
			"app/main.go": USES_DOM,
		},
		(dir) => {
			const options = {
				stdlibRoot: join(dir, "stdlib"),
				packageCache: new PackageCache(),
			};
			const before = declarationStats.parsed;
			compileDir(join(dir, "app"), options);
			compileDir(join(dir, "app"), options);
			assertEqual(declarationStats.parsed - before, 1);
		},
	);
});

section("Declaration packages — unresolved references in composite types");

const NODES = `
interface Node { children: Node[]; appendChild(n: Node): Node; on(cb: (e: Node) => void): void; }
`;

test("a declaration slice or func type prints like its Go-source twin", () => {
	const { res, errors } = build(
		`package main

import "gofront/dom"

func main() {
	var e dom.Node
	var a any = e.children
	var b any = e.appendChild
	_, ok1 := a.([]dom.Node)
	_, ok2 := b.(func(dom.Node) dom.Node)
	println(ok1, ok2)
}
`,
		{ stdlib: { "stdlib/gofront/dom/dom.d.ts": NODES } },
	);
	assertEqual(errors.length, 0);
	assert(!res.js.includes("gofront/"), "leaked an internal type key");
	assert(res.js.includes('"[]dom.Node"'), "slice descriptor");
	assert(res.js.includes('"func(dom.Node) dom.Node"'), "func descriptor");
	const types = [...res.js.matchAll(/__i?s?ty\([^"]*"([^"]*)"/g)].map(
		(m) => m[1],
	);
	assertEqual(new Set(types).size, 2);
});

test("an error about a declaration func type does not show the internal key", () => {
	const { errors } = build(
		`package main

import "gofront/dom"

func main() {
	var e dom.Node
	var n int = e.appendChild
	var m int = e.children
	println(n, m)
}
`,
		{ stdlib: { "stdlib/gofront/dom/dom.d.ts": NODES } },
	);
	assertErrorContains(errors, "func(dom.Node) dom.Node");
	assertErrorContains(errors, "[]dom.Node");
	for (const e of errors) assert(!e.message.includes("gofront/"), e.message);
});

test("a declaration-package assertion does not collide with a Go struct of the same name", () => {
	const { res, errors } = build(
		`package main

import (
	"gofront/webgpu"
	"./fakegpu"
)

func accept(d any) webgpu.Device {
	return d.(webgpu.Device)
}

func main() {
	var raw any = &fakegpu.Device{Label: "fake"}
	dev := accept(raw)
	switch dev.(type) {
	case webgpu.Device:
		println("ok")
	}
}
`,
		{
			extra: {
				"app/fakegpu/fakegpu.go": `package fakegpu

type Device struct {
	Label string
}
`,
			},
			stdlib: {
				"stdlib/gofront/webgpu/webgpu.d.ts": `interface Device { destroy(): void; }`,
			},
		},
	);
	assertEqual(errors.map((e) => e.message).join(), "");
	assertEqual(runJs(res.js).trim(), "ok");
});

test("feature-detecting a browser method against nil reads the property directly", () => {
	const { res, errors } = build(
		`package main

func main() {
	if window != nil && window.matchMedia != nil {
		println("has")
		return
	}
	println("missing")
}
`,
		{
			stdlib: {
				"stdlib/gofront/dom/dom.d.ts": `interface MediaQueryList { matches: boolean; }
interface Window { matchMedia(query: string): MediaQueryList; }
`,
			},
		},
	);
	assertEqual(errors.map((e) => e.message).join(), "");
	assert(
		!res.js.includes("=> window.matchMedia("),
		`expected direct property read, got:\n${res.js}`,
	);
	assertEqual(runJs(res.js, { window: {} }).trim(), "missing");
	assertEqual(
		runJs(res.js, {
			window: { matchMedia: () => ({ matches: true }) },
		}).trim(),
		"has",
	);
});

section("Declaration packages — list parameters and dictionary members");

const GPU_LISTS = `
interface CommandBuffer { label: string; }
interface CommandEncoder { finish(): CommandBuffer; }
/** @dictionary */
interface BindGroupLayoutEntry { binding: int; }
/** @dictionary */
interface BindGroupLayoutDescriptor { entries: BindGroupLayoutEntry[]; label?: string; }
/** @dictionary */
interface ColorTargetState { format: string; }
/** @dictionary */
interface FragmentState { targets: (ColorTargetState | null)[]; }
interface Queue { submit(commandBuffers: CommandBuffer[]): void; }
interface Device {
	queue: Queue;
	createCommandEncoder(): CommandEncoder;
	createBindGroupLayout(d: BindGroupLayoutDescriptor): void;
}
`;

const gpuLists = (body) =>
	build(`package main\n\nimport "gofront/webgpu"\n\n${body}\n`, {
		stdlib: { "stdlib/gofront/webgpu/webgpu.d.ts": GPU_LISTS },
	});

test("a slice of the declared element type is a list parameter", () => {
	const { errors } = gpuLists(`func f(dev webgpu.Device) {
	enc := dev.createCommandEncoder()
	dev.queue.submit([]webgpu.CommandBuffer{enc.finish()})
	var cmds []webgpu.CommandBuffer = []webgpu.CommandBuffer{}
	dev.queue.submit(cmds)
}

func main() {}`);
	assertEqual(errors.map((e) => e.message).join(), "");
});

test("a dictionary member that is a list takes a slice of its element type", () => {
	const { errors } = gpuLists(`func f(dev webgpu.Device) {
	dev.createBindGroupLayout(map[string]any{
		"entries": []webgpu.BindGroupLayoutEntry{map[string]any{"binding": 0}},
	})
}

func main() {}`);
	assertEqual(errors.map((e) => e.message).join(), "");
});

test("a list parameter rejects a slice of any", () => {
	const { errors } =
		gpuLists(`func f(dev webgpu.Device, enc webgpu.CommandEncoder) {
	dev.queue.submit([]any{enc.finish()})
}

func main() {}`);
	assertErrorContains(errors, "[]any");
	assertErrorContains(errors, "as []webgpu.CommandBuffer value");
});

test("a dictionary member that is a list rejects a slice of any", () => {
	const { errors } = gpuLists(`func f(dev webgpu.Device) {
	dev.createBindGroupLayout(map[string]any{
		"entries": []any{map[string]any{"binding": 0}},
	})
}

func main() {}`);
	assertErrorContains(errors, "as []webgpu.BindGroupLayoutEntry value");
	assertErrorContains(errors, "member entries");
});

test("a dictionary member of the declared element type still checks its keys", () => {
	const { errors } = gpuLists(`func f(dev webgpu.Device) {
	dev.createBindGroupLayout(map[string]any{
		"entries": []webgpu.BindGroupLayoutEntry{map[string]any{"bindin": 0}},
	})
}

func main() {}`);
	assertErrorContains(errors, "unknown member 'bindin'");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
