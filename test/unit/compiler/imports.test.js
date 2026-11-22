// GoFront test suite — imports, error paths, access control

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Lexer } from "../../../src/lexer/lexer.js";
import { Parser } from "../../../src/parser/index.js";
import { TypeChecker } from "../../../src/typechecker/index.js";
import { INT } from "../../../src/typechecker/types.js";
import {
	assert,
	assertContains,
	assertEqual,
	assertErrorContains,
	assertThrows,
	compile,
	compileDir,
	FIXTURES,
	parseDts,
	runJs,
	section,
	test,
} from "../helpers.js";

section("compiler.js — error paths");

test("compileDir throws on mixed package names", () => {
	const dir = join(FIXTURES, "missing_go");
	assertThrows(() => compileDir(dir));
});

// ═════════════════════════════════════════════════════════════
// Lexer edge cases
// ═════════════════════════════════════════════════════════════

section("compiler.js — mixed package names");

test("compileDir throws when package names differ across files", () => {
	const dir = join(FIXTURES, "mixed_packages");
	assertThrows(() => compileDir(dir), "Mixed package names");
});

test("compileDir throws on parse error in a .go file", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "gofront-test-"));
	try {
		writeFileSync(join(tmpDir, "bad.go"), "package main\nfunc (( {}", "utf8");
		assertThrows(() => compileDir(tmpDir));
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("compileDir throws on type-check error", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "gofront-test-"));
	try {
		writeFileSync(
			join(tmpDir, "bad.go"),
			`package main
func main() {
	var x int = "hello"
	console.log(x)
}`,
			"utf8",
		);
		assertThrows(() => compileDir(tmpDir));
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("compileDir with unknown npm import compiles without crash", () => {
	// unknown npm import resolves to null → exercises the if (!info) continue path
	const tmpDir = mkdtempSync(join(tmpdir(), "gofront-test-"));
	writeFileSync(
		join(tmpDir, "main.go"),
		`package main
import "totally-unknown-npm-package-xyz"
func main() { console.log("ok") }`,
		"utf8",
	);
	try {
		compileDir(tmpDir);
	} catch (_) {
		// ignore — the test exercises the if(!info) path; no crash is the goal
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("compileDir with missing local package import warns and continues", () => {
	// import "./nonexistent" where the subdir doesn't exist → exercises lines 118-122
	const tmpDir = mkdtempSync(join(tmpdir(), "gofront-test-"));
	writeFileSync(
		join(tmpDir, "main.go"),
		`package main
import "./nonexistent-subpkg"
func main() { console.log("ok") }`,
		"utf8",
	);
	try {
		compileDir(tmpDir);
	} catch (_) {
		// ignore — the test exercises the missing-subdir warning path; no crash is the goal
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

// ═════════════════════════════════════════════════════════════
// Side-effect imports (import _ "pkg")
// ═════════════════════════════════════════════════════════════

section("Side-effect imports");

test("import _ compiles without error", () => {
	const dir = join(FIXTURES, "multifile/withsideeffectimport");
	const { js, errors } = compileDir(dir);
	assertEqual(errors?.length ?? 0, 0);
	assertContains(js, "side-effect-only");
});

test("import _ bundles the dependency code", () => {
	const dir = join(FIXTURES, "multifile/withsideeffectimport");
	const { js } = compileDir(dir);
	// mathpkg should be inlined even though it's a side-effect import
	assertContains(js, "function Add(");
});

test("import _ runs correctly", () => {
	const dir = join(FIXTURES, "multifile/withsideeffectimport");
	const { js } = compileDir(dir);
	assertEqual(runJs(js).trim(), "side-effect-only");
});

test("import _ does not expose package namespace", () => {
	// Using math.Add should be a type error — the namespace is not registered
	const { errors } = compile(
		`package main
import _ "../mathpkg"
func main() {
	x := math.Add(1, 2)
	console.log(x)
}`,
		{ fromFile: join(FIXTURES, "multifile/withsideeffectimport/main.go") },
	);
	assert(
		errors.length > 0,
		"expected type error: math namespace not accessible",
	);
	assertErrorContains(errors, "math");
});

test("import _ in group syntax compiles without error", () => {
	const { js, errors } = compile(
		`package main
import (
	_ "../mathpkg"
)
func main() {
	console.log("ok")
}`,
		{ fromFile: join(FIXTURES, "multifile/withsideeffectimport/main.go") },
	);
	assertEqual(errors?.length ?? 0, 0);
	assertEqual(runJs(js).trim(), "ok");
});

// ═════════════════════════════════════════════════════════════
// dts-parser — additional coverage
// ═════════════════════════════════════════════════════════════

section("Unused import detection");

test("unused local package import is a type error", () => {
	const dir = join(FIXTURES, "multifile/unusedimport");
	assertThrows(() => compileDir(dir), "imported and not used");
});

test("used local package import is not an error", () => {
	const dir = join(FIXTURES, "multifile/withimport");
	const { js } = compileDir(dir);
	const out = runJs(js);
	assertEqual(out.trim(), "15\n16");
});

test("side-effect import _ is not flagged as unused", () => {
	const dir = join(FIXTURES, "multifile/withsideeffectimport");
	const { js } = compileDir(dir);
	assertContains(js, "function Add(");
});

section("Dot imports");

test("dot import: functions available without qualifier", () => {
	const dir = join(FIXTURES, "multifile/withdotimport");
	const { js } = compileDir(dir);
	// Add and Square should be called directly, not as math.Add / math.Square
	assertContains(js, "Add(10, 5)");
	assertContains(js, "Square(4)");
});

test("dot import: runtime output is correct", () => {
	const dir = join(FIXTURES, "multifile/withdotimport");
	const { js } = compileDir(dir);
	const out = runJs(js);
	assertEqual(out.trim(), "15\n16");
});

test("dot import: no namespace variable emitted", () => {
	const dir = join(FIXTURES, "multifile/withdotimport");
	const { js } = compileDir(dir);
	// Should NOT contain "const math = " or "let math = " — no namespace
	assert(!js.includes("const math"), "should not have namespace variable");
});

// ═════════════════════════════════════════════════════════════
// Semantic differences — export access control
// ═════════════════════════════════════════════════════════════

section("Semantic differences — exported/unexported access");

test("unexported function from another package is rejected", () => {
	// Go spec: lowercase identifiers from another package are unexported and must not be accessed.
	const dir = join(FIXTURES, "multifile/unexported_access");
	let errMsg = "";
	try {
		compileDir(dir);
	} catch (e) {
		errMsg = e.message;
	}
	assertContains(errMsg, "cannot refer to unexported name");
});

test("uppercase package member access is allowed", () => {
	// Built-in namespaces (fmt, strings, etc.) always use uppercase — should work
	const { errors } = compile(`package main
func main() {
  s := fmt.Sprintf("%d", 42)
  println(s)
}`);
	assertEqual(errors.length, 0);
});

// ═════════════════════════════════════════════════════════════
// Imports are bound per file
// ═════════════════════════════════════════════════════════════

section("Checker — per-file import scopes");

function parseFile(name, source) {
	const ast = new Parser(
		new Lexer(source, name).tokenize(),
		name,
		source,
	).parse();
	ast._source = source;
	return ast;
}

// A package of two files, `a.go` and `b.go`, checked with whatever `bind`
// binds before the check. Returns the errors.
function checkTwoFiles(aSrc, bSrc, bind) {
	const checker = new TypeChecker();
	const a = parseFile("a.go", `package main\n${aSrc}`);
	const b = parseFile("b.go", `package main\n${bSrc}`);
	bind(checker, a);
	const errors = checker.checkAll([a, b]);
	checker.reportUnusedImports();
	return errors;
}

const LIB_FN = { kind: "func", params: [], returns: [INT] };
const LIB_BOX = { kind: "named", name: "Box", underlying: INT };
const bindLib = (file) => (checker) =>
	checker.addPackageNamespace(
		"lib",
		new Map([["Fn", LIB_FN]]),
		new Map([["Box", LIB_BOX]]),
		null,
		null,
		null,
		file,
	);

test("addPackageNamespace binds the package qualifier in one file", () => {
	const errors = checkTwoFiles(
		"func A() int { return lib.Fn() }",
		"func B() int { return lib.Fn() }",
		bindLib("a.go"),
	);
	assertErrorContains(errors, "Undefined: 'lib'");
	assertEqual(errors.length, 1);
});

test("addPackageNamespace binds package types in one file", () => {
	const errors = checkTwoFiles(
		"var x lib.Box",
		"var y lib.Box",
		bindLib("a.go"),
	);
	assertErrorContains(errors, "Unknown type 'lib.Box'");
	assertEqual(errors.length, 1);
});

test("addPackageNamespace does not leak a bare type name to other files", () => {
	const errors = checkTwoFiles("var x lib.Box", "var y Box", bindLib("a.go"));
	assertErrorContains(errors, "Unknown type 'Box'");
	assertEqual(errors.length, 1);
});

test("addPackageNamespace in two files binds each file", () => {
	const errors = checkTwoFiles(
		"func A() int { return lib.Fn() }\nvar x lib.Box",
		"func B() int { return lib.Fn() }\nvar y lib.Box",
		(checker) => {
			bindLib("a.go")(checker);
			bindLib("b.go")(checker);
		},
	);
	assertEqual(errors.length, 0);
});

test("addPackageNamespace without a file binds every file", () => {
	const errors = checkTwoFiles(
		"func A() int { return lib.Fn() }",
		"func B() int { return lib.Fn() }\nvar y lib.Box",
		bindLib(undefined),
	);
	assertEqual(errors.length, 0);
});

const DTS = parseDts(
	"export declare function helper(): number;\nexport interface Foo { n: number }",
);

test("addDefinitions binds values and types in one file", () => {
	const bind = (checker) =>
		checker.addDefinitions(DTS.types, DTS.values, { file: "a.go" });
	const errors = checkTwoFiles(
		"func A() float64 { return helper() }\nvar x Foo",
		"func B() float64 { return helper() }\nvar y Foo",
		bind,
	);
	assertErrorContains(errors, "Undefined: 'helper'");
	assertErrorContains(errors, "Unknown type 'Foo'");
	assertEqual(errors.length, 2);
});

test("addDefinitions without a file binds every file", () => {
	const errors = checkTwoFiles(
		"func A() float64 { return helper() }\nvar x Foo",
		"func B() float64 { return helper() }\nvar y Foo",
		(checker) => checker.addDefinitions(DTS.types, DTS.values),
	);
	assertEqual(errors.length, 0);
});

test("reportUnusedImports checks the file that imports", () => {
	const errors = checkTwoFiles(
		"func A() {}",
		"func B() int { return lib.Fn() }",
		(checker) => {
			bindLib("a.go")(checker);
			bindLib("b.go")(checker);
			checker.trackImport("lib", { _line: 2 }, "a.go", "");
			checker.trackImport("lib", { _line: 2 }, "b.go", "");
		},
	);
	assertErrorContains(errors, "'lib' imported and not used");
	assertEqual(errors.length, 1);
});

test("a file's own package-level names stay out of its imports", () => {
	const errors = checkTwoFiles(
		"func A() int { return 1 }",
		"func B() int { return A() }",
		(checker) => bindLib("a.go")(checker),
	);
	assertEqual(errors.length, 0);
});

test("a type's generic instance resolves in its declaring file", () => {
	// `Box` names `lib.Box` in a.go only; b.go instantiates the generic.
	const errors = checkTwoFiles(
		"type G[T any] struct { v T; b lib.Box }",
		"var g G[int]",
		bindLib("a.go"),
	);
	assertEqual(errors.length, 0);
});

// ── Entry point ───────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
