import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { compileFiles, compileSingleFile } from "../../../src/compiler.js";
import { renameDotImportedTypes } from "../../../src/link/type-names.js";
import {
	assert,
	assertContains,
	assertEqual,
	assertErrorContains,
	assertThrows,
	compile,
	compileDir,
	compileHybridProject,
	FIXTURES,
	ROOT,
	runInDom,
	runJs,
	section,
	summarize,
	test,
	toCompileResult,
	withTempDir,
} from "../helpers.js";

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
func main() { console.log("ok", totally_unknown_pkg) }`,
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
	assertErrorContains(errors, "No member 'Nonexistent'");
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

section("Example app — simple (todo)");

test("simple example compiles without errors", () => {
	const exampleDir = join(ROOT, "example", "simple", "src");
	const result = compileDir(exampleDir);
	assert(result.js && result.js.length > 0, "expected non-empty JS output");
});

test("simple example exports expected functions", () => {
	const exampleDir = join(ROOT, "example", "simple", "src");
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

section("Example app — preact (todo)");

test("preact example compiles without errors", () => {
	const exampleDir = join(ROOT, "example", "preact", "src");
	const result = compileDir(exampleDir);
	assert(result.js && result.js.length > 0, "expected non-empty JS output");
});

test("preact example exports expected functions", () => {
	const exampleDir = join(ROOT, "example", "preact", "src");
	const result = compileDir(exampleDir);
	assert(result.exportedSymbols.has("main"), "expected main to be exported");
	assert(result.exportedSymbols.has("App"), "expected App to be exported");
	assert(
		result.exportedSymbols.has("TodoItem"),
		"expected TodoItem to be exported",
	);
	assert(
		result.exportedSymbols.has("Header"),
		"expected Header to be exported",
	);
});

test("example store logic runs correctly (addTodo / stats)", () => {
	const exampleDir = join(ROOT, "example", "simple", "src");
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

test("simple utils.Plural formats correctly", () => {
	const utilsDir = join(ROOT, "example", "simple", "src", "utils");
	const result = compileDir(utilsDir);
	assert(result.js.includes("Plural"), "expected Plural in output");
});

test("preact utils.Plural formats correctly", () => {
	const utilsDir = join(ROOT, "example", "preact", "src", "utils");
	const result = compileDir(utilsDir);
	assert(result.js.includes("Plural"), "expected Plural in output");
});

test("multi-file package infers package-level var type across file sort order", () => {
	withTempDir(
		{
			"a_caller.go": `package main
func checkMap(k string) (string, bool) {
  val, ok := cache[k]
  return val, ok
}
`,
			"z_store.go": `package main
var cache = map[string]string{"hit": "yes"}
func main() {
  v, ok := checkMap("hit")
  console.log(v, ok)
  v2, ok2 := checkMap("miss")
  console.log(v2, ok2)
}
`,
		},
		(dir) => {
			const fileA = join(dir, "a_caller.go");
			const fileZ = join(dir, "z_store.go");
			const { js } = compileFiles([fileA, fileZ]);
			// Should emit comma-ok map index, NOT destructuring [val, ok] = cache[k]
			assert(
				js.includes("in cache") || js.includes("cache[k]"),
				"expected map comma-ok check",
			);
			assert(
				!js.includes("let [val, ok] = cache[k]"),
				"should not emit array destructuring for map index",
			);
			const output = runJs(js);
			assertEqual(output, "yes true\n false");
		},
	);
});

test("multi-file package resolves struct types declared across file sort order", () => {
	withTempDir(
		{
			"a_container.go": `package main
type Container struct {
  Item Element
}
func (c *Container) GetValue() int {
  return c.Item.Value
}
`,
			"z_element.go": `package main
type Element struct {
  Value int
}
func main() {
  var c Container
  c.Item.Value = 42
  println(c.GetValue())
}
`,
		},
		(dir) => {
			const fileA = join(dir, "a_container.go");
			const fileZ = join(dir, "z_element.go");
			const { js } = compileFiles([fileA, fileZ]);
			const output = runJs(js);
			assertEqual(output.trim(), "42");
		},
	);
});

test("diamond local imports bundle the shared package only once", () => {
	// main → ./a, ./b; a → ../base; b → ../base
	withTempDir(
		{
			"base/base.go": `package base
type Thing struct{ V int }
func Make(v int) *Thing { return &Thing{V: v} }
`,
			"a/a.go": `package a
import "../base"
func Twice(v int) int { return base.Make(v).V * 2 }
`,
			"b/b.go": `package b
import "../base"
func Thrice(v int) int { return base.Make(v).V * 3 }
`,
			"main.go": `package main
import (
  "./a"
  "./b"
  "./base"
)
func main() {
  println(a.Twice(2) + b.Thrice(2) + base.Make(1).V)
}
`,
		},
		(dir) => {
			const { js } = compileDir(dir);
			assertEqual((js.match(/^class Thing\b/gm) ?? []).length, 1);
			assertEqual(runJs(js).trim(), "11");
		},
	);
});

test("imported struct literals, zero values and &T{} construct the class", () => {
	withTempDir(
		{
			"geo/geo.go": `package geo
type Vec struct{ X, Y float32 }
func (v *Vec) Sum() float32 { return v.X + v.Y }
`,
			"main.go": `package main
import "./geo"

var scratch = &geo.Vec{}

func fill(out *geo.Vec) { out.X = 1; out.Y = 2 }

func main() {
	fill(scratch)
	println(scratch.Sum())
	local := &geo.Vec{X: 4}
	println(local.Sum())
	var zero geo.Vec
	fill(&zero)
	println(zero.Sum())
	val := geo.Vec{X: 7, Y: 1}
	p := &val
	println(p.Sum())
}
`,
		},
		(dir) => {
			const { js } = compileDir(dir);
			assertContains(js, "let scratch = new Vec()");
			assertContains(js, "let zero = new Vec()");
			assertEqual(runJs(js).trim(), "3\n4\n3\n8");
		},
	);
});

section("compileFiles — sourceMap");

test("compileFiles with sourceMap appends sourceMappingURL comment", () => {
	withTempDir(
		{ "main.go": `package main\nfunc main() { console.log("hi") }\n` },
		(dir) => {
			const file = join(dir, "main.go");
			const { js } = compileFiles([file], { sourceMap: true, outputDir: dir });
			assertContains(js, "sourceMappingURL=data:application/json;base64,");
		},
	);
});

test("omitted field of imported struct type is zero-initialised, not null", () => {
	withTempDir(
		{
			"geo/v.go": `package geo
type V struct{ X float32 }
func NewV() *V { return &V{} }
`,
			"main.go": `package main
import "./geo"
type C struct{ P geo.V; N int }
func main() {
  c := &C{N: 1}
  console.log(c.P.X, geo.NewV().X)
}
`,
		},
		(dir) => {
			const { js, errors } = compileDir(dir);
			assertEqual(errors?.length ?? 0, 0);
			assertEqual(runJs(js), "0 0");
		},
	);
});

test("compileFiles with sourceMap embeds source content", () => {
	withTempDir(
		{ "main.go": `package main\nfunc main() { console.log("hi") }\n` },
		(dir) => {
			const file = join(dir, "main.go");
			const { js } = compileFiles([file], { sourceMap: true, outputDir: dir });
			const b64 = js.split("base64,")[1].trim();
			const map = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
			assert(
				Array.isArray(map.sourcesContent) && map.sourcesContent.length > 0,
				"expected sourcesContent in source map",
			);
		},
	);
});

test("compileFiles with subpackage imports includes all packages in source map", () => {
	withTempDir(
		{
			"math/calc.go": `package math\nfunc Add(a, b int) int { return a + b }\n`,
			"main.go": `package main\nimport "./math"\nfunc main() { console.log(math.Add(1, 2)) }\n`,
		},
		(dir) => {
			const mainFile = join(dir, "main.go");
			const { js } = compileFiles([mainFile], {
				sourceMap: true,
				outputDir: dir,
			});
			const b64 = js.split("base64,")[1].trim();
			const map = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
			assert(
				map.sources.includes("math/calc.go"),
				`expected math/calc.go in map.sources: ${JSON.stringify(map.sources)}`,
			);
			assert(
				map.sources.includes("main.go"),
				`expected main.go in map.sources: ${JSON.stringify(map.sources)}`,
			);
			assertEqual(map.sourcesContent.length, map.sources.length);
			assert(map.sourcesContent.some((c) => c.includes("func Add")));
			assert(map.sourcesContent.some((c) => c.includes("math.Add(1, 2)")));
			const matches = js.match(/\/\/# sourceMappingURL=/g);
			assertEqual(matches?.length, 1);
		},
	);
});

test("compileSingleFile with subpackage includes all packages in source map", () => {
	withTempDir(
		{
			"greet/hello.go": `package greet\nfunc Hello() string { return "hello" }\n`,
			"main.go": `package main\nimport "./greet"\nfunc main() { console.log(greet.Hello()) }\n`,
		},
		(dir) => {
			const mainFile = join(dir, "main.go");
			const { js } = compileSingleFile(mainFile, {
				sourceMap: true,
				outputFile: join(dir, "out.js"),
			});
			const b64 = js.split("base64,")[1].trim();
			const map = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
			assert(
				map.sources.includes("greet/hello.go"),
				`expected greet/hello.go in map.sources: ${JSON.stringify(map.sources)}`,
			);
			assert(
				map.sources.includes("main.go"),
				`expected main.go in map.sources: ${JSON.stringify(map.sources)}`,
			);
		},
	);
});

test("compileSingleFile generates json, errors.As and fmt helpers", () => {
	withTempDir(
		{
			"main.go": `package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
)

type P struct{ X int }

func main() {
	b, _ := json.Marshal(P{1})
	fmt.Println(string(b))
	_, err := strconv.Atoi("x")
	var ne *strconv.NumError
	fmt.Println(errors.As(err, &ne), ne.Func)
	fmt.Println(fmt.Sprintf("%v", P{1}))
}
`,
		},
		(dir) => {
			const { js } = compileSingleFile(join(dir, "main.go"));
			assertEqual(runJs(js), '{"X":1}\ntrue Atoi\n{1}');
		},
	);
});

test("multi-file package maps methods in second file to second file in source map", () => {
	withTempDir(
		{
			"types.go": `package main\ntype User struct{ Name string }\nfunc main() {}\n`,
			"methods.go": `package main\nfunc (u *User) Greet() string { return "Hi " + u.Name }\n`,
		},
		(dir) => {
			const typeFile = join(dir, "types.go");
			const methodFile = join(dir, "methods.go");
			const { js } = compileFiles([typeFile, methodFile], {
				sourceMap: true,
				outputDir: dir,
			});
			const b64 = js.split("base64,")[1].trim();
			const map = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
			assertEqual(
				JSON.stringify(map.sources),
				JSON.stringify(["types.go", "methods.go"]),
			);
			assert(map.mappings.length > 0, "expected mappings to not be empty");
		},
	);
});

section("Package target directives & validation");

test("conflicting //gofront:target directives in same package throws error", () => {
	withTempDir(
		{
			"a.go": "//gofront:target js\npackage mypkg\nfunc A() {}\n",
			"b.go": "//gofront:target wasm\npackage mypkg\nfunc B() {}\n",
		},
		(dir) => {
			assertThrows(
				() => compileDir(dir),
				/Conflicting \/\/gofront:target directives in package 'mypkg'/,
			);
		},
	);
});

test("//gofront:target wasm rejects js: imports and gom and external imports", () => {
	withTempDir(
		{
			"main.go":
				'//gofront:target wasm\npackage main\nimport _ "js:canvas"\nfunc main() {}\n',
		},
		(dir) => {
			assertThrows(
				() => compileDir(dir),
				/js: imports are not allowed in wasm packages/,
			);
		},
	);

	withTempDir(
		{
			"main.go":
				'//gofront:target wasm\npackage main\nimport "gom"\nfunc main() {}\n',
		},
		(dir) => {
			assertThrows(
				() => compileDir(dir),
				/package 'gom' is not available in wasm packages/,
			);
		},
	);

	withTempDir(
		{
			"main.go":
				'//gofront:target wasm\npackage main\nimport _ "some/external/pkg"\nfunc main() {}\n',
		},
		(dir) => {
			assertThrows(
				() => compileDir(dir),
				/js: imports are not allowed in wasm packages/,
			);
		},
	);
});

test("//gofront:target both cannot import js package", () => {
	withTempDir(
		{
			"main.go":
				'//gofront:target both\npackage main\nimport "./sub"\nfunc main() {}\n',
			"sub/sub.go": "//gofront:target js\npackage sub\nfunc Sub() {}\n",
		},
		(dir) => {
			assertThrows(() => compileDir(dir), /cannot import 'sub' \(js\)/);
		},
	);
});

test("//gofront:target both cannot import wasm package", () => {
	withTempDir(
		{
			"main.go":
				'//gofront:target both\npackage main\nimport "./sub"\nfunc main() {}\n',
			"sub/sub.go": "//gofront:target wasm\npackage sub\nfunc Sub() {}\n",
		},
		(dir) => {
			assertThrows(
				() => compileDir(dir),
				/can only import 'both' packages; 'sub' is wasm/,
			);
		},
	);
});

section("same type name in two local packages");

const PT_PACKAGES = (target) => ({
	"a/a.go": `//gofront:target ${target}\npackage a\ntype Pt struct{ X int }\nfunc (p Pt) Get() int { return p.X }\n`,
	"b/b.go": `//gofront:target ${target}\npackage b\ntype Pt struct{ Y string }\nfunc (p Pt) Get() string { return p.Y }\n`,
});

for (const target of ["js", "both", "wasm"]) {
	test(`a.Pt and b.Pt coexist in one program (${target})`, async () => {
		const { lines } = await compileHybridProject({
			...PT_PACKAGES(target),
			"main.go": `//gofront:target ${target}
package main
import ("fmt"; "./a"; "./b")
func main() { fmt.Println(a.Pt{1}, b.Pt{"y"}, a.Pt{4}.Get(), b.Pt{"q"}.Get()) }
`,
		});
		assertEqual(lines.join("\n"), "{1} {y} 4 q");
	});
}

test("generic instances over different package types are distinct", () => {
	withTempDir(
		{
			...PT_PACKAGES("js"),
			"main.go": `//gofront:target js
package main
import ("./a"; "./b")
type Box[T any] struct{ v T }
func main() {
	var x Box[a.Pt]
	x = Box[b.Pt]{}
	_ = x
}
`,
		},
		(dir) => {
			assertThrows(
				() => compileDir(dir),
				"cannot use Box[b.Pt]{} (value of type Box[b.Pt]) as Box[Pt] value in assignment",
			);
		},
	);
});

// Package b redeclares `Pt`, so its type is renamed; same-spelled values
// (parameters, locals, composite literal keys) must keep their names.
const B_BODIES = {
	"composite literal field key": [
		`type Container struct{ Pt Pt }\nfunc Make(Pt Pt) Container { return Container{Pt: Pt} }\nfunc (c Container) Y() string { return c.Pt.Y }`,
		`fmt.Println(b.Make(b.Pt{"k"}).Y())`,
		"k",
	],
	parameter: [
		`func Foo(Pt int) int { return Pt + 1 }`,
		`fmt.Println(b.Foo(2))`,
		"3",
	],
	"local variable": [
		`func Foo() int { var Pt int = 10; return Pt + 1 }`,
		`fmt.Println(b.Foo())`,
		"11",
	],
};

for (const [what, [body, call, want]] of Object.entries(B_BODIES)) {
	test(`renamed type does not rename a ${what}`, async () => {
		const { lines } = await compileHybridProject({
			"a/a.go": "package a\ntype Pt struct{ X int }\n",
			"b/b.go": `package b\ntype Pt struct{ Y string }\n${body}\n`,
			"main.go": `package main\nimport ("fmt"; "./a"; "./b")\nvar _ = a.Pt{}\nfunc main() { ${call} }\n`,
		});
		assertEqual(lines.join("\n"), want);
	});
}

test("parse cache never serves renamed ASTs to a later build", () => {
	withTempDir(
		{
			"a/a.go": "package a\ntype Pt struct{ X int }\n",
			"b/b.go": "package b\ntype Pt struct{ Y string }\n",
			"main.go": `package main\nimport ("./a"; "./b")\nvar _ = a.Pt{}\nvar _ = b.Pt{}\nfunc main() {}\n`,
		},
		(dir) => {
			const rel = (f) => relative(process.cwd(), join(dir, f));
			const typeOwners = new Map();
			compileFiles([rel("a/a.go")], { typeOwners });
			compileFiles([rel("b/b.go")], { typeOwners });
			const res = compileFiles([rel("b/b.go")]);
			const decl = res.programs[0].decls.find((d) => d.kind === "TypeDecl");
			assertEqual(decl.name, "Pt");
		},
	);
});

section("package type resolution across packages");

const PKG_CASES = {
	"qualified literal beats a same-named type in main": [
		{
			"a/a.go": "package a\ntype Pt struct{ X int }\n",
			"main.go": `package main
import ("fmt"; "./a")
type Pt struct{ Z bool }
func main() { fmt.Println(Pt{true}, a.Pt{1}) }
`,
		},
		"{true} {1}",
	],
	"literal of a cross-package struct alias": [
		{
			"p/p.go": "package p\ntype Base struct{ V int }\ntype A = Base\n",
			"main.go": `package main
import ("fmt"; "./p")
func main() { fmt.Println(p.A{42}) }
`,
		},
		"{42}",
	],
	"array length from a package constant": [
		{
			"main.go": `package main
import ("fmt"; "math")
func main() { var a [math.MaxInt8]int; fmt.Println(len(a), math.Pi > 3) }
`,
		},
		"127 true",
	],
	"array length from a package constant is a use of the import": [
		{
			"main.go": `package main
import ("fmt"; "math")
func main() { var a [math.MaxInt8]int; fmt.Println(len(a)) }
`,
		},
		"127",
	],
	"cross-package struct value parameter is copied": [
		{
			"pkg/pkg.go":
				"package pkg\ntype S struct{ X int }\nfunc (s *S) Inc() { s.X++ }\n",
			"main.go": `package main
import ("fmt"; "./pkg")
func f(s pkg.S) { s.Inc() }
func main() { s := pkg.S{X: 1}; f(s); fmt.Println(s.X) }
`,
		},
		"1",
	],
};

for (const [name, [files, want]] of Object.entries(PKG_CASES)) {
	for (const target of ["js", "both", "wasm"]) {
		test(`${name} (${target})`, async () => {
			const withTarget = Object.fromEntries(
				Object.entries(files).map(([k, v]) => [
					k,
					`//gofront:target ${target}\n${v}`,
				]),
			);
			const { lines } = await compileHybridProject(withTarget);
			assertEqual(lines.join("\n"), want);
		});
	}
}

section("Packages export only what they declare");

// Compiles `files` in a temp dir and returns the error messages.
function packageErrors(files) {
	return withTempDir(files, (dir) => {
		const { errors } = toCompileResult(() => compileDir(dir));
		return errors;
	});
}

const MYDEP_FILES = {
	"node_modules/mydep/package.json": '{"name":"mydep","types":"index.d.ts"}',
	"node_modules/mydep/index.d.ts": "export declare const Bar: number;\n",
};

const LEAF_FILES = {
	"leaf/leaf.go": `package leaf

type Leaf struct{ N int }

func LeafFn() int { return 7 }
`,
};

test("a package does not export the values of a typed npm import (I1.7)", () => {
	const errors = packageErrors({
		...MYDEP_FILES,
		"sub/sub.go": `package sub

import "mydep"

func Use() float64 { return Bar }
`,
		"main.go": `package main

import "./sub"

func main() { println(sub.Bar) }
`,
	});
	assertEqual(errors.length, 1);
	assertErrorContains(errors, "No member 'Bar' in namespace sub");
});

for (const [name, imp, body, use, want] of [
	[
		"a dot-imported function",
		'import . "../leaf"',
		"return LeafFn()",
		"println(sub.LeafFn())",
		"No member 'LeafFn' in namespace sub",
	],
	[
		"a dot-imported type",
		'import . "../leaf"',
		"var _ Leaf; return 1",
		"var _ sub.Leaf",
		"Unknown type 'sub.Leaf'",
	],
	[
		"an import alias used as a type",
		'import Leaf "../leaf"',
		"var _ Leaf.Leaf; return 1",
		"var _ sub.Leaf",
		"Unknown type 'sub.Leaf'",
	],
	[
		"a type of an imported package",
		'import "../leaf"',
		"var _ leaf.Leaf; return 1",
		"var _ sub.Leaf",
		"Unknown type 'sub.Leaf'",
	],
]) {
	test(`a package does not export ${name} (I1.10)`, () => {
		const errors = packageErrors({
			...LEAF_FILES,
			"sub/sub.go": `package sub

${imp}

func Use() int { ${body} }
`,
			"main.go": `package main

import "./sub"

func main() { ${use} }
`,
		});
		assertErrorContains(errors, want);
	});
}

test("a package still exports what it declares", () => {
	withTempDir(
		{
			...MYDEP_FILES,
			...LEAF_FILES,
			"sub/sub.go": `package sub

import (
	"mydep"
	. "../leaf"
)

var Baz = 1

type Own struct{ V int }

func Use() float64 { return float64(LeafFn()) }

func Other() float64 { return Bar }
`,
			"main.go": `package main

import "./sub"

func main() {
	o := sub.Own{V: 2}
	println(sub.Use(), sub.Baz, o.V)
}
`,
		},
		(dir) => assertEqual(runJs(compileDir(dir).js).trim(), "7 1 2"),
	);
});

test("importing a local package does not hide universe types (simd.F32x4, shared.Float32)", () => {
	withTempDir(
		{
			"sub/sub.go": `package sub

func One() float32 { return 1 }
`,
			"main.go": `package main

import (
	"gofront/shared"
	"gofront/simd"
	"./sub"
)

type box struct {
	v simd.F32x4
	s shared.Float32
}

var buf = shared.NewFloat32(2)

func main() {
	b := box{v: simd.Splat(sub.One()), s: buf}
	println(b.v.Lane(0), len(b.s))
}
`,
		},
		(dir) => assertEqual(runJs(compileDir(dir).js).trim(), "1 2"),
	);
});

test("a package does not export predeclared universe types", () => {
	const errors = packageErrors({
		"sub/sub.go": `package sub

func One() int { return 1 }
`,
		"main.go": `package main

import "./sub"

func main() {
	var _ sub.Float32Array
	println(sub.One())
}
`,
	});
	assertErrorContains(errors, "Unknown type 'sub.Float32Array'");
});

section("unexported interface methods belong to their package");

const SECRET_UTIL = `package util

type I interface {
	secret() int
	Pub() int
}

type Base struct{}

func (Base) secret() int { return 7 }
func (Base) Pub() int    { return 1 }

type Impl struct{}

func (Impl) secret() int { return 3 }
func (Impl) Pub() int    { return 2 }

func Use(i I) int { return i.Pub() }

type baseI interface{ secret() int }

type Embeds interface {
	baseI
	Pub() int
}
`;

const MINE_DECL = `type Mine struct{}

func (Mine) secret() int { return 1 }
func (Mine) Pub() int    { return 2 }
`;

function secretErrors(body, extraUtil = "") {
	return packageErrors({
		"util/util.go": SECRET_UTIL + extraUtil,
		"main.go": `package main

import "./util"

${MINE_DECL}
${body}

func main() {}
`,
	});
}

for (const [name, body, message] of [
	["value assignment", "var _ util.I = Mine{}", "Mine does not implement I"],
	["pointer assignment", "var _ util.I = &Mine{}", "does not implement I"],
	[
		"interface to interface",
		"type localI interface{ secret() int; Pub() int }\nvar li localI = Mine{}\nvar _ util.I = li",
		"does not implement I",
	],
	[
		"call argument",
		"func f() int { return util.Use(Mine{}) }",
		"Mine does not implement I",
	],
	[
		"return value",
		"func f() util.I { return Mine{} }",
		"Mine does not implement I",
	],
	["slice literal", "var _ = []util.I{Mine{}}", "does not implement I"],
	[
		"type assertion",
		"func f(i util.I) { _ = i.(Mine) }",
		"impossible type assertion",
	],
	[
		"type switch case",
		"func f(i util.I) int {\n\tswitch i.(type) {\n\tcase Mine:\n\t\treturn 1\n\t}\n\treturn 0\n}",
		"impossible type switch case",
	],
	[
		"generic constraint",
		"func g[T util.I](x T) int { return x.Pub() }\nvar _ = g(Mine{})",
		"does not satisfy constraint I",
	],
	[
		"embedded unexported interface",
		"var _ util.Embeds = Mine{}",
		"Mine does not implement Embeds",
	],
]) {
	test(`foreign type cannot satisfy foreign interface: ${name}`, () => {
		assertErrorContains(secretErrors(body), message);
	});
}

test("foreign type cannot satisfy foreign embedded interface in a local interface", () => {
	const errors = secretErrors(
		"type Wrap interface{ util.I }\nvar _ Wrap = Mine{}",
	);
	assertErrorContains(errors, "Wrap");
});

for (const [name, body] of [
	[
		"embedding util.Base",
		"type Good struct{ util.Base }\nvar _ util.I = Good{}",
	],
	[
		"embedding *util.Base",
		"type Good struct{ *util.Base }\nvar _ util.I = Good{Base: &util.Base{}}",
	],
	["util.Impl", "var _ util.I = util.Impl{}"],
	["util.Use(util.Impl{})", "var _ = util.Use(util.Impl{})"],
]) {
	test(`foreign interface still satisfied: ${name}`, () => {
		assertEqual(secretErrors(body).length, 0);
	});
}

test("embedding a generic util.Base[int] satisfies the foreign interface", () => {
	const errors = packageErrors({
		"util/util.go": `package util

type I interface {
	secret() int
	Pub() int
}

type Base[T any] struct{ V T }

func (b Base[T]) secret() int { return 7 }
func (b Base[T]) Pub() int    { return 1 }
`,
		"main.go": `package main

import "./util"

type Good struct{ util.Base[int] }

var _ util.I = Good{}

func main() {}
`,
	});
	assertEqual(errors.length, 0);
});

test("unexported interface methods still match within one package", () => {
	const errors = packageErrors({
		"main.go": `package main

type I interface{ secret() int }
type T struct{}

func (T) secret() int { return 1 }

var _ I = T{}

func main() {}
`,
	});
	assertEqual(errors.length, 0);
});

section("dot-imported collision-mangled types");

const dotPkgs = (target, files, mainBody) => ({
	...Object.fromEntries(
		Object.entries(files).map(([path, src]) => [
			path,
			`//gofront:target ${target}\n${src}`,
		]),
	),
	"main.go": `//gofront:target ${target}
package main
import (
	"fmt"
${Object.keys(files)
	.filter((f) => f.endsWith(".go"))
	.map((f) => `\t${f.startsWith("b/") ? "." : ""} "./${f.split("/")[0]}"`)
	.join("\n")}
)
${mainBody}
`,
});

for (const target of ["js", "both", "wasm"]) {
	test(`dot-imported type named after a JS built-in converts (${target})`, async () => {
		const { lines } = await compileHybridProject({
			"util/util.go": `//gofront:target ${target}\npackage util\ntype Map int\n`,
			"main.go": `//gofront:target ${target}
package main
import (
	"fmt"
	. "./util"
)
func main() { fmt.Println(int(Map(3))) }
`,
		});
		assertEqual(lines.join("\n"), "3");
	});

	test(`qualified type named after a JS built-in still converts (${target})`, async () => {
		const { lines } = await compileHybridProject({
			"util/util.go": `//gofront:target ${target}\npackage util\ntype Map int\n`,
			"main.go": `//gofront:target ${target}
package main
import (
	"fmt"
	"./util"
)
func main() { fmt.Println(int(util.Map(3))) }
`,
		});
		assertEqual(lines.join("\n"), "3");
	});

	test(`dot-imported type colliding with another package converts (${target})`, async () => {
		const { lines } = await compileHybridProject(
			dotPkgs(
				target,
				{
					"a/a.go": "package a\ntype Num int\nfunc One() Num { return 1 }\n",
					"b/b.go": "package b\ntype Num int\n",
				},
				"var _ = a.One\nfunc main() { fmt.Println(int(Num(2))) }",
			),
		);
		assertEqual(lines.join("\n"), "2");
	});

	test(`dot-imported type used only in a type position still works (${target})`, async () => {
		const { lines } = await compileHybridProject(
			dotPkgs(
				target,
				{
					"a/a.go": "package a\ntype Num int\nfunc One() Num { return 1 }\n",
					"b/b.go": "package b\ntype Num int\n",
				},
				"var _ = a.One\nfunc main() {\n\tvar x Num = 2\n\tfmt.Println(int(x))\n}",
			),
		);
		assertEqual(lines.join("\n"), "2");
	});
}

for (const target of ["js", "both", "wasm"]) {
	test(`dot-imported colliding struct literal and method survive pruning (${target})`, async () => {
		const { lines } = await compileHybridProject(
			dotPkgs(
				target,
				{
					"a/a.go":
						"package a\ntype Box struct{ V int }\nfunc One() Box { return Box{1} }\n",
					"b/b.go":
						"package b\ntype Box struct{ V int }\nfunc (b Box) Get() int { return b.V }\n",
				},
				"var _ = a.One\nfunc main() {\n\tvar x Box\n\tx.V = 5\n\tfmt.Println(Box{V: 2}.Get(), x.Get())\n}",
			),
		);
		assertEqual(lines.join("\n"), "2 5");
	});

	test(`dot-imported colliding struct as variable, literal and pointer (${target})`, async () => {
		const { lines } = await compileHybridProject(
			dotPkgs(
				target,
				{
					"a/a.go":
						"package a\ntype Box struct{ V int }\nfunc One() Box { return Box{1} }\n",
					"b/b.go":
						"package b\ntype Box struct{ V int }\nfunc (b *Box) Get() int { return b.V }\nfunc Make() Box { return Box{V: 9} }\n",
				},
				`var _ = a.One
type Emb struct{ Box }
func take(b *Box, bs []Box, m map[string]Box) int { return b.Get() + len(bs) + len(m) }
func main() {
	var x Box
	x.V = 5
	p := &Box{V: 7}
	n := new(Box)
	n.V = 3
	fmt.Println(x.V, p.Get(), Make().V, Emb{Box{V: 6}}.V)
	fmt.Println(take(n, []Box{{V: 1}, Box{V: 2}}, map[string]Box{"k": {V: 4}}))
}`,
			),
		);
		assertEqual(lines.join("\n"), "5 7 9 6\n6");
	});

	test(`dot-imported colliding generic struct (${target})`, async () => {
		const { lines } = await compileHybridProject(
			dotPkgs(
				target,
				{
					"a/a.go":
						"package a\ntype Box[T any] struct{ V T }\nfunc One() Box[int] { return Box[int]{V: 1} }\n",
					"b/b.go":
						"package b\ntype Box[T any] struct{ V T }\nfunc (b Box[T]) Get() T { return b.V }\n",
				},
				`var _ = a.One
func wrap[T any](v T) Box[T] { return Box[T]{V: v} }
func main() {
	var x Box[int]
	x.V = 5
	p := &Box[string]{V: "s"}
	fmt.Println(x.V, Box[int]{V: 2}.Get(), p.Get(), wrap(8).Get())
}`,
			),
		);
		assertEqual(lines.join("\n"), "5 2 s 8");
	});
}

const SHADOW_A =
	"package a\ntype Box struct{ V int }\nfunc One() Box { return Box{1} }\n";
const SHADOW_B =
	"package b\ntype Box struct{ V int }\nfunc (b Box) Get() int { return b.V }\n";

for (const target of ["js", "both", "wasm"]) {
	test(`function-local type shadows a dot-imported type only in its block (${target})`, async () => {
		const { lines } = await compileHybridProject(
			dotPkgs(
				target,
				{ "b/b.go": SHADOW_B },
				"func f() int { type Box int; return int(Box(3)) }\nfunc main() {\n\tvar x Box\n\tx.V = 5\n\tfmt.Println(f(), x.V)\n}",
			),
		);
		assertEqual(lines.join("\n"), "3 5");
	});

	// Each program declares the local type once, so it keeps its name until
	// the dot import is resolved.
	for (const [shape, decl, call] of [
		[
			"func literal",
			"var g = func() int { type Box struct{ W int }; return Box{W: 1}.W }",
			"g()",
		],
		[
			"method",
			"type T struct{}\nfunc (T) m() int { type Box struct{ W int }; p := &Box{W: 1}; return p.W }",
			"T{}.m()",
		],
		[
			"nested block",
			"func g() int {\n\ty := Box{V: 2}\n\t{\n\t\ttype Box struct{ W int }\n\t\tz := []Box{{W: 1}}\n\t\treturn z[0].W * y.Get() / 2\n\t}\n}",
			"g()",
		],
	])
		test(`function-local struct in a ${shape} shadowing a colliding dot-imported type (${target})`, async () => {
			const { lines } = await compileHybridProject(
				dotPkgs(
					target,
					{ "a/a.go": SHADOW_A, "b/b.go": SHADOW_B },
					`var _ = a.One\n${decl}\nfunc main() { fmt.Println(${call}, Box{V: 6}.Get()) }`,
				),
			);
			assertEqual(lines.join("\n"), "1 6");
		});

	test(`a later package's local type does not reuse a dot-import shadow's name (${target})`, async () => {
		const { lines } = await compileHybridProject(
			dotPkgs(
				target,
				{
					"b/b.go": SHADOW_B,
					"c/c.go":
						"package c\nfunc C() int { type Box struct{ Z int }; return Box{Z: 7}.Z }\n",
				},
				"func f() int { type Box struct{ W int }; return Box{W: 3}.W }\nfunc main() { fmt.Println(f(), c.C(), Box{V: 1}.Get()) }",
			),
		);
		assertEqual(lines.join("\n"), "3 7 1");
	});

	// The shadow's new name is emitted at the top level, where another file
	// of the package may already declare it as a value.
	for (const sibling of [
		"var Box__L1 = 99",
		"const Box__L1 = 99",
		"func Box__L1() int { return 99 }",
	])
		test(`a dot-import shadow's name avoids a sibling file's \`${sibling.split(" ")[0]}\` (${target})`, async () => {
			const use = sibling.startsWith("func") ? "Box__L1()" : "Box__L1";
			const { lines } = await compileHybridProject({
				...dotPkgs(
					target,
					{ "a/a.go": SHADOW_A, "b/b.go": SHADOW_B },
					"var _ = a.One\nfunc f() int { type Box struct{ W int }; return Box{W: 3}.W }\nfunc main() { fmt.Println(f(), Box{V: 5}.Get(), GetL1()) }",
				),
				"f2.go": `//gofront:target ${target}\npackage main\n${sibling}\nfunc GetL1() int { return ${use} }\n`,
			});
			assertEqual(lines.join("\n"), "3 5 99");
		});
}

test("diagnostics spell a renamed type the way the source does", () => {
	const errors = packageErrors({
		"b/b.go": "package b\ntype Num int\n",
		"main.go": `package main
import . "./b"
func f() { type Num string; var n int = Num("x"); _ = n }
func main() { var s string = Num(3); _ = s }
`,
	});
	assertErrorContains(errors, 'cannot use Num("x") (constant "x" of type Num)');
	assertErrorContains(errors, "cannot use Num(3) (constant 3 of type b.Num)");
});

section("collision-mangled types in .templ expressions");

// Builds the project, mounts `View()` into #app and returns its text.
function templText(files) {
	const { js } = withTempDir(files, (dir) => compileDir(dir));
	const { lines } = runInDom(js, '<div id="app"></div>');
	return lines.join("\n");
}

const TEMPL_A =
	"package a\ntype Box[T any] struct{ V T }\nfunc One() Box[int] { return Box[int]{V: 1} }\n";
const TEMPL_B =
	"package b\ntype Box[T any] struct{ V T }\nfunc (b Box[T]) Get() T { return b.V }\n";

const templMain = (mount = "View()", imports = "") => `package main
import (
	"./a"
${imports})
var _ = a.One
func main() {
	gom.Mount("#app", ${mount})
	println(document.querySelector("#app").textContent)
}
`;

test("a dot-imported colliding generic type in every .templ expression position", () => {
	const text = templText({
		"a/a.go": TEMPL_A,
		"b/b.go": TEMPL_B,
		"main.go": templMain(),
		"view.templ": `package main
import (
	"strconv"
	. "./b"
)
func mk(n int) Box[int] { return Box[int]{V: n} }
templ View() {
	for _, it := range []Box[int]{mk(2)} {
		<i>{ strconv.Itoa(it.Get()) }</i>
	}
	if new(Box[int]).Get() == 0 {
		<b>3</b>
	} else if new(Box[int]).Get() == 9 {
		<b>9</b>
	}
	switch mk(4).Get() {
	case new(Box[int]).Get(), Box[int](mk(4)).Get():
		<s>4</s>
	}
	<p title={ strconv.Itoa(Box[int](mk(5)).V) }>{ strconv.Itoa(func() int { var x Box[int]; x.V = 6; return x.Get() }()) }</p>
	<div>
		@Item(*new(Box[int]))
	</div>
}
templ Item(b Box[int]) {
	<em>{ strconv.Itoa(b.Get() + 7) }</em>
}`,
	});
	assertEqual(text, "23467");
});

test("a .templ function-local type shadows a dot-imported colliding type", () => {
	const text = templText({
		"a/a.go": TEMPL_A,
		"b/b.go": TEMPL_B,
		"main.go": templMain(),
		"view.templ": `package main
import (
	"strconv"
	. "./b"
)
templ View() {
	<span>{ strconv.Itoa(func() int { type Box struct{ W int }; return Box{W: 8}.W }()) }</span>
	<span>{ strconv.Itoa(func() int { var x Box[int]; x.V = 9; return x.Get() }()) }</span>
}`,
	});
	assertEqual(text, "89");
});

test("a package's own .templ file uses its collision-mangled type", () => {
	const text = templText({
		"a/a.go": TEMPL_A,
		"b/b.go": TEMPL_B,
		"b/view.templ": `package b
import "strconv"
templ View() {
	<span>{ strconv.Itoa(func() int { var x Box[int]; x.V = 42; return x.Get() }()) }</span>
}`,
		"main.go": templMain("b.View()", '\t"./b"\n'),
	});
	assertEqual(text, "42");
});

test("a .templ function-local type does not replace a package-level type", () => {
	const text = templText({
		"main.go": `package main
type T struct{ A int }
func main() {
	gom.Mount("#app", View())
	println(T{A: 1}.A, document.querySelector("#app").textContent)
}
`,
		"view.templ": `package main
import "strconv"
templ View() {
	<span>{ strconv.Itoa(func() int { type T struct{ W int }; return T{W: 4}.W }()) }</span>
}`,
	});
	assertEqual(text, "1 4");
});

test("a type the file declares itself is not renamed by a dot import", () => {
	const program = {
		decls: [
			{ kind: "TypeDecl", name: "Box", type: { kind: "StructType" } },
			{
				kind: "VarDecl",
				decls: [{ names: ["x"], type: { kind: "TypeName", name: "Box" } }],
			},
			{
				kind: "VarDecl",
				decls: [{ names: ["y"], type: { kind: "TypeName", name: "Num" } }],
			},
		],
	};
	renameDotImportedTypes(
		program,
		new Map([
			["Box", "Box$$b"],
			["Num", "Num$$b"],
		]),
	);
	assertEqual(program.decls[0].name, "Box");
	assertEqual(program.decls[1].decls[0].type.name, "Box");
	assertEqual(program.decls[2].decls[0].type.name, "Num$$b");
});

test("a function-local type shadowing a dot import takes a name no other type uses", () => {
	const local = {
		kind: "TypeDecl",
		name: "Box",
		type: { kind: "TypeName", name: "int" },
	};
	const localUse = { kind: "TypeName", name: "Box" };
	const program = {
		decls: [
			{
				kind: "FuncDecl",
				name: "f",
				params: [],
				body: [
					local,
					{ kind: "VarDecl", decls: [{ names: ["y"], type: localUse }] },
				],
			},
			{
				kind: "VarDecl",
				decls: [{ names: ["x"], type: { kind: "TypeName", name: "Box" } }],
			},
		],
	};
	const owners = new Map([
		["Box", "/main"],
		["Box__L1", "/c"],
	]);
	renameDotImportedTypes(
		program,
		new Map([["Box", "Box$$b"]]),
		owners,
		"/main",
	);
	assertEqual(local.name, "Box__L2");
	assertEqual(localUse.name, "Box__L2");
	assertEqual(program.decls[1].decls[0].type.name, "Box$$b");
	assertEqual(owners.get("Box__L2"), "/main");
});

test("a renamed type is exported under its declared name in every export table", () => {
	withTempDir(
		{
			"util/util.go":
				"package util\ntype Map int\nfunc One() Map { return 1 }\n",
		},
		(dir) => {
			const res = compileDir(join(dir, "util"));
			for (const table of [
				res.exportedTypes,
				res.exportedSymbols,
				res.exportedKinds,
			])
				assert(table.has("Map"), "export table is missing 'Map'");
			assertEqual(res.exportedKinds.get("Map"), "type");
			assertEqual(res.exportedSymbols.get("Map"), res.exportedTypes.get("Map"));
		},
	);
});

section("generated Go: types of other local packages");

// Every file of the project carries the target directive of `target`.
const onTarget = (target, files) =>
	Object.fromEntries(
		Object.entries(files).map(([path, src]) => [
			path,
			target === "js" ? src : `//gofront:target ${target}\n${src}`,
		]),
	);

const SUB_MYINT = "package sub\ntype MyInt int\n";
const JSON_IMPORTS = '"fmt"\n"encoding/json"';

for (const target of ["js", "both", "wasm"]) {
	const run = async (files) =>
		(await compileHybridProject(onTarget(target, files))).lines.join("\n");

	const decode = (imports, decls, body) => `package main
import (
${JSON_IMPORTS}
${imports}
)
${decls}
func main() {
${body}
}
`;

	test(`json.Unmarshal into a struct holding an imported type (${target})`, async () => {
		const out = await run({
			"sub/sub.go": SUB_MYINT,
			"main.go": decode(
				'"./sub"',
				"type Wrap struct{ B sub.MyInt }",
				'var w Wrap\n\terr := json.Unmarshal([]byte(`{"B":3}`), &w)\n\tfmt.Println(w.B, err)',
			),
		});
		assertEqual(out, "3 <nil>");
	});

	test(`json.Unmarshal into an imported struct whose field has its package's type (${target})`, async () => {
		const out = await run({
			"sub/sub.go": "package sub\ntype MyInt int\ntype W struct{ N MyInt }\n",
			"main.go": decode(
				'"./sub"',
				"",
				'var w sub.W\n\terr := json.Unmarshal([]byte(`{"N":4}`), &w)\n\tfmt.Println(w.N, err)',
			),
		});
		assertEqual(out, "4 <nil>");
	});

	test(`json.Unmarshal into an imported type reached through an alias (${target})`, async () => {
		const out = await run({
			"sub/sub.go": SUB_MYINT,
			"main.go": decode(
				's "./sub"',
				"type Wrap struct{ B s.MyInt; P *s.MyInt }",
				'var w Wrap\n\terr := json.Unmarshal([]byte(`{"B":3,"P":9}`), &w)\n\tfmt.Println(w.B, *w.P, err)',
			),
		});
		assertEqual(out, "3 9 <nil>");
	});

	test(`json.Unmarshal into types two files import under different aliases (${target})`, async () => {
		const out = await run({
			"sub/sub.go": SUB_MYINT,
			"a.go": 'package main\nimport s1 "./sub"\ntype A struct{ B s1.MyInt }\n',
			"main.go": decode(
				's2 "./sub"',
				"type Wrap struct{ B s2.MyInt }",
				'var w Wrap\n\tvar a A\n\terr := json.Unmarshal([]byte(`{"B":3}`), &w)\n\tjson.Unmarshal([]byte(`{"B":5}`), &a)\n\tfmt.Println(w.B, a.B, err)',
			),
		});
		assertEqual(out, "3 5 <nil>");
	});

	test(`json.Unmarshal into a dot-imported type (${target})`, async () => {
		const out = await run({
			"sub/sub.go": SUB_MYINT,
			"main.go": decode(
				'. "./sub"',
				"type Wrap struct{ B MyInt }",
				'var w Wrap\n\terr := json.Unmarshal([]byte(`{"B":3}`), &w)\n\tfmt.Println(w.B, err)',
			),
		});
		assertEqual(out, "3 <nil>");
	});

	test(`json.Unmarshal into a type another package declares from a third (${target})`, async () => {
		const out = await run({
			"leaf/leaf.go": "package leaf\ntype Num int\n",
			"mid/mid.go":
				'package mid\nimport "../leaf"\ntype M struct{ N leaf.Num }\n',
			"main.go": decode(
				'"./mid"',
				"",
				'var m mid.M\n\terr := json.Unmarshal([]byte(`{"N":4}`), &m)\n\tfmt.Printf("%v %T %v\\n", m.N, m.N, err)',
			),
		});
		assertEqual(out, "4 leaf.Num <nil>");
	});

	test(`json.Unmarshal when a sibling file's variable shares the import's name (${target})`, async () => {
		const out = await run({
			"sub/sub.go": SUB_MYINT,
			"a.go": 'package main\nimport s "./sub"\ntype A struct{ B s.MyInt }\n',
			"b.go": "package main\nvar s = 99\n",
			"main.go": decode(
				"",
				"",
				'var a A\n\terr := json.Unmarshal([]byte(`{"B":5}`), &a)\n\tfmt.Println(a.B, s, err)',
			),
		});
		assertEqual(out, "5 99 <nil>");
	});

	test(`json and fmt keep types of colliding packages apart (${target})`, async () => {
		const a =
			"package a\ntype Box struct{ V int }\ntype Num int\ntype G[T any] struct{ X T }\nfunc MkA() Box { return Box{1} }\n";
		const b =
			"package b\ntype Box struct{ V int }\ntype Num int\ntype G[T any] struct{ X T }\nfunc MkB() Box { return Box{2} }\n";
		const body = `var w W
	err := json.Unmarshal([]byte(\`{"A":{"V":3},"B":{"V":4},"N":5,"M":6,"G":{"X":7},"H":{"X":8}}\`), &w)
	out, _ := json.Marshal(w)
	fmt.Println(w, err, string(out))
	fmt.Printf("%T %T %T %T %T %T\\n", w.A, w.B, w.N, w.M, w.G, w.H)
	fmt.Printf("%+v\\n", w)`;
		const want = `{{3} {4} 5 6 {7} {8}} <nil> {"A":{"V":3},"B":{"V":4},"N":5,"M":6,"G":{"X":7},"H":{"X":8}}
a.Box b.Box a.Num b.Num a.G[int] b.G[int]
{A:{V:3} B:{V:4} N:5 M:6 G:{X:7} H:{X:8}}`;
		assertEqual(
			await run({
				"a/a.go": a,
				"b/b.go": b,
				"main.go": decode(
					'"./a"\n"./b"',
					"type W struct{ A a.Box; B b.Box; N a.Num; M b.Num; G a.G[int]; H b.G[int] }",
					body,
				),
			}),
			want,
		);
		assertEqual(
			await run({
				"a/a.go": a,
				"b/b.go": b,
				"main.go": decode(
					'"./a"\n. "./b"',
					"type W struct{ A a.Box; B Box; N a.Num; M Num; G a.G[int]; H G[int] }\nvar _ = MkB",
					body,
				),
			}),
			want,
		);
	});

	test(`%T names the package clause of a local package (${target})`, async () => {
		const out = await run({
			"mathx/vec.go": "package vec\ntype V struct{ X, Y int }\n",
			"main.go": `package main
import (
	"fmt"
	"./mathx"
)
func main() { fmt.Printf("%T %v\\n", vec.V{1, 2}, vec.V{1, 2}) }
`,
		});
		assertEqual(out, "vec.V {1 2}");
	});

	test(`json.Marshal of a type with an imported type argument (${target})`, async () => {
		const out = await run({
			"sub/sub.go": SUB_MYINT,
			"main.go": decode(
				'"./sub"',
				"type Box[T any] struct{ V T }",
				'b, _ := json.Marshal(Box[sub.MyInt]{4})\n\tfmt.Printf("%s %T\\n", b, Box[sub.MyInt]{4})',
			),
		});
		assertEqual(out, '{"V":4} main.Box[sub.MyInt]');
	});

	test(`fmt and json name an imported generic type its package also aliases an instance of (${target})`, async () => {
		const util =
			"package util\ntype Pair[T any] struct{ A, B T }\ntype IntPair = Pair[int]\n";
		assertEqual(
			await run({
				"util/util.go": util,
				"main.go": `package main
import (
	"fmt"
	"./util"
)
func main() { fmt.Printf("%T %v\\n", util.Pair[int]{1, 2}, util.Pair[int]{1, 2}) }
`,
			}),
			"util.Pair[int] {1 2}",
		);
		assertEqual(
			await run({
				"util/util.go": util,
				"main.go": decode(
					'"./util"',
					"",
					'var p util.IntPair\n\tvar q util.Pair[string]\n\terr := json.Unmarshal([]byte(`{"A":1,"B":2}`), &p)\n\tjson.Unmarshal([]byte(`{"A":"x"}`), &q)\n\tfmt.Printf("%T %v %T %q %v\\n", p, p, q, q.A, err)',
				),
			}),
			'util.Pair[int] {1 2} util.Pair[string] "x" <nil>',
		);
	});

	test(`json and fmt name a renamed type another package imports under an alias (${target})`, async () => {
		const out = await run({
			"leaf/leaf.go":
				"package leaf\ntype Num int\ntype G[T any] struct{ X T }\n",
			"mid/mid.go":
				'package mid\nimport l "../leaf"\ntype M struct{ N l.Num; H l.G[int] }\n',
			"main.go": decode(
				'"./mid"',
				"type Num int\ntype G[T any] struct{ X T }",
				'var m mid.M\n\terr := json.Unmarshal([]byte(`{"N":4,"H":{"X":5}}`), &m)\n\tfmt.Printf("%v %T %v %T %v %v %v\\n", m.N, m.N, m.H, m.H, err, Num(1), G[int]{2})',
			),
		});
		assertEqual(out, "4 leaf.Num {5} leaf.G[int] <nil> 1 {2}");
	});

	test(`errors.As into a renamed type another package imports under an alias (${target})`, async () => {
		const out = await run({
			"leaf/leaf.go":
				'package leaf\ntype MyErr struct{ C int }\nfunc (e *MyErr) Error() string { return "e" }\n',
			"mid/mid.go":
				'package mid\nimport l "../leaf"\nfunc F() error { return &l.MyErr{7} }\nfunc G() *l.MyErr { return nil }\n',
			"main.go": `package main
import (
	"errors"
	"fmt"
	"./mid"
)
type MyErr struct{}
func (MyErr) Error() string { return "m" }
func main() {
	e := mid.G()
	fmt.Println(errors.As(mid.F(), &e), e.C, MyErr{})
}
`,
		});
		assertEqual(out, "true 7 m");
	});

	test(`json and fmt name a renamed type of a package with a non-ASCII name (${target})`, async () => {
		const out = await run({
			"sub/sub.go":
				"package café\ntype MyInt int\ntype G[T any] struct{ X T }\n",
			"main.go": decode(
				'"./sub"',
				"type MyInt int\ntype G[T any] struct{ X T }\ntype W struct{ B café.MyInt; H café.G[int] }",
				'var w W\n\terr := json.Unmarshal([]byte(`{"B":3,"H":{"X":4}}`), &w)\n\tfmt.Printf("%v %T %v %T %v %v %v\\n", w.B, w.B, w.H, w.H, err, MyInt(1), G[int]{2})',
			),
		});
		assertEqual(out, "3 café.MyInt {4} café.G[int] <nil> 1 {2}");
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
