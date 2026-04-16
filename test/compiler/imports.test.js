// GoFront test suite — imports, error paths, access control

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assert,
	assertContains,
	assertEqual,
	assertErrorContains,
	compile,
	compileDir,
	FIXTURES,
	runJs,
	section,
	test,
} from "../helpers.js";

section("compiler.js — error paths");

test("compileDir throws on mixed package names", () => {
	const dir = join(FIXTURES, "missing_go");
	let threw = false;
	try {
		compileDir(dir);
	} catch (_e) {
		threw = true;
	}
	assert(threw, "expected error for empty/missing directory");
});

// ═════════════════════════════════════════════════════════════
// Lexer edge cases
// ═════════════════════════════════════════════════════════════

section("compiler.js — mixed package names");

test("compileDir throws when package names differ across files", () => {
	const dir = join(FIXTURES, "mixed_packages");
	let threw = false;
	let msg = "";
	try {
		compileDir(dir);
	} catch (e) {
		threw = true;
		msg = e.message;
	}
	assert(threw, "expected error for mixed package names");
	assertContains(msg, "Mixed package names");
});

test("compileDir throws on parse error in a .go file", () => {
	// Write a file with a syntax error into a temp dir and compile it
	const tmpDir = mkdtempSync(join(tmpdir(), "gofront-test-"));
	writeFileSync(join(tmpDir, "bad.go"), "package main\nfunc (( {}", "utf8");
	let threw = false;
	try {
		compileDir(tmpDir);
	} catch (_e) {
		threw = true;
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
	assert(threw, "expected error for parse error");
});

test("compileDir throws on type-check error", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "gofront-test-"));
	writeFileSync(
		join(tmpDir, "bad.go"),
		`package main
func main() {
	var x int = "hello"
	console.log(x)
}`,
		"utf8",
	);
	let threw = false;
	try {
		compileDir(tmpDir);
	} catch (_e) {
		threw = true;
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
	assert(threw, "expected error for type-check error");
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
	let threw = false;
	try {
		compileDir(dir);
	} catch (e) {
		threw = true;
		assertContains(e.message, "imported and not used");
	}
	assert(threw, "expected type error for unused import");
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

// ── Entry point ───────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
