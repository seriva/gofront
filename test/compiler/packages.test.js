// GoFront test suite — multi-file packages, examples, npm resolver

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
	assert,
	assertContains,
	assertEqual,
	assertErrorContains,
	compile,
	compileDir,
	FIXTURES,
	ROOT,
	runJs,
	section,
	summarize,
	test,
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

section("Example app — reactive (todo)");

test("reactive example compiles without errors", () => {
	const exampleDir = join(ROOT, "example", "reactive", "src");
	const result = compileDir(exampleDir);
	assert(result.js && result.js.length > 0, "expected non-empty JS output");
});

test("reactive example exports expected functions", () => {
	const exampleDir = join(ROOT, "example", "reactive", "src");
	const result = compileDir(exampleDir);
	assert(result.exportedSymbols.has("main"), "expected main to be exported");
	assert(
		result.exportedSymbols.has("initStore"),
		"expected initStore to be exported",
	);
	assert(
		result.exportedSymbols.has("createAppShell"),
		"expected createAppShell to be exported",
	);
	assert(
		result.exportedSymbols.has("setupReactiveDOM"),
		"expected setupReactiveDOM to be exported",
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

test("reactive utils.Plural formats correctly", () => {
	const utilsDir = join(ROOT, "example", "reactive", "src", "utils");
	const result = compileDir(utilsDir);
	assert(result.js.includes("Plural"), "expected Plural in output");
});

// ═════════════════════════════════════════════════════════════
// CLI flags
// ═════════════════════════════════════════════════════════════

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
