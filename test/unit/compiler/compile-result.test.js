// GoFront test suite — structured compile errors and returned warnings

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CompileError,
	compileDir,
	compileFiles,
} from "../../../src/compiler.js";
import {
	assert,
	assertContains,
	assertEqual,
	section,
	test,
} from "../helpers.js";

function inTempDir(files, fn) {
	const dir = mkdtempSync(join(tmpdir(), "gofront-result-"));
	try {
		for (const [rel, src] of Object.entries(files))
			writeFileSync(join(dir, rel), src);
		return fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function catchError(fn) {
	try {
		fn();
	} catch (e) {
		return e;
	}
	return null;
}

section("compileFiles diagnostics");

test("type errors throw a CompileError with one entry per error", () => {
	inTempDir(
		{ "main.go": "package main\nfunc main() {\n\t_ = x\n\t_ = y\n}\n" },
		(dir) => {
			const err = catchError(() => compileFiles([join(dir, "main.go")]));
			assert(err instanceof CompileError, `got ${err}`);
			assertEqual(err.errors.length, 2);
			assertEqual(err.message, err.errors.map((e) => e.message).join("\n"));
			assertContains(err.message, "Undefined");
		},
	);
});

test("a parse error throws a CompileError", () => {
	inTempDir({ "main.go": "package main\nfunc main() { goto }\n" }, (dir) => {
		const err = catchError(() => compileFiles([join(dir, "main.go")]));
		assert(err instanceof CompileError, `got ${err}`);
		assertEqual(err.errors.length, 1);
	});
});

test("mixed package names throw a CompileError", () => {
	inTempDir(
		{
			"a.go": "package a\nfunc A() {}\n",
			"b.go": "package b\nfunc B() {}\n",
		},
		(dir) => {
			const err = catchError(() => compileDir(dir));
			assert(err instanceof CompileError, `got ${err}`);
			assertContains(err.message, "Mixed package names");
		},
	);
});

test("conflicting target directives throw a CompileError", () => {
	inTempDir(
		{
			"a.go": "//gofront:target js\npackage p\nfunc A() {}\n",
			"b.go": "//gofront:target wasm\npackage p\nfunc B() {}\n",
		},
		(dir) => {
			const err = catchError(() => compileDir(dir));
			assert(err instanceof CompileError, `got ${err}`);
			assertContains(err.message, "Conflicting //gofront:target");
		},
	);
});

test("compileFiles returns warnings", () => {
	inTempDir(
		{
			"main.go":
				"package main\nfunc main() {\n\tvar x int = 9007199254740993\n\t_ = x\n}\n",
		},
		(dir) => {
			const res = compileFiles([join(dir, "main.go")], {
				forceTarget: "js",
			});
			assert(
				res.warnings.some((w) => w.includes("2^53") || w.includes("precision")),
				`warnings: ${res.warnings.join("|")}`,
			);
		},
	);
});
