// GoFront test suite — local import cycles and the package dependency graph

import { resolve } from "node:path";
import { handleCheck } from "../../../src/cli/cli-core.js";
import {
	CompileError,
	compileDir,
	compilePackageTests,
	compileSingleFile,
} from "../../../src/compiler.js";
import {
	assert,
	assertContains,
	assertEqual,
	section,
	test,
	withTempDir,
} from "../helpers.js";

section("compiler.js — import cycles and package graph");

function catchErr(fn) {
	try {
		fn();
	} catch (e) {
		return e;
	}
	return null;
}

// The cycle diagnostic fn throws: a CompileError, never a stack overflow.
function cycleError(fn) {
	const e = catchErr(fn);
	assert(e instanceof CompileError, `CompileError, got ${e?.name}: ${e}`);
	assert(
		!e.message.includes("Maximum call stack"),
		"no stack overflow reported",
	);
	assertContains(e.message, "import cycle not allowed");
	return e;
}

test("a package that imports itself is an import cycle", () => {
	withTempDir({ "a/a.go": 'package a\nimport "./"\nvar X = 1\n' }, (dir) => {
		const e = cycleError(() => compileDir(resolve(dir, "a")));
		assertContains(e.message, "a imports a");
		assertContains(e.message, "a.go at line 2:8");
	});
});

test("a two-package cycle names the path and the import", () => {
	withTempDir(
		{
			"main.go": 'package main\nimport "./a"\nfunc main() { _ = a.A }\n',
			"a/a.go": 'package a\nimport "../b"\nvar A = b.B\n',
			"b/b.go": 'package b\nimport "../a"\nvar B = a.A\n',
		},
		(dir) => {
			const e = cycleError(() => compileDir(dir));
			assertContains(e.message, "a imports b imports a");
			// reported at the first import of the cycle: a's import of b
			assertContains(e.message, "a.go at line 2:8");
			assertContains(e.message, 'import "../b"');
			assertEqual(e.errors.length, 1);
		},
	);
});

test("a cycle of three packages names every member", () => {
	withTempDir(
		{
			"a/a.go": 'package a\nimport "../b"\nvar A = b.B\n',
			"b/b.go": 'package b\nimport "../c"\nvar B = c.C\n',
			"c/c.go": 'package c\nimport "../a"\nvar C = a.A\n',
		},
		(dir) => {
			const e = cycleError(() => compileDir(resolve(dir, "b")));
			assertContains(e.message, "b imports c imports a imports b");
			assertContains(e.message, "b.go at line 2:8");
		},
	);
});

test("compileSingleFile reports a cycle behind its imports", () => {
	withTempDir(
		{
			"main.go": 'package main\nimport "./a"\nfunc main() { _ = a.A }\n',
			"a/a.go": 'package a\nimport "../"\nvar A = 1\n',
		},
		(dir) => {
			const e = cycleError(() => compileSingleFile(resolve(dir, "main.go")));
			assertContains(e.message, "main imports a imports main");
			assertContains(e.message, "main.go at line 2:8");
		},
	);
});

test("compilePackageTests reports a cycle through a test file", () => {
	withTempDir(
		{
			"a/a.go": "package a\nfunc A() int { return 1 }\n",
			"a/a_test.go":
				'package a\nimport "../b"\nimport "testing"\nfunc TestA(t *testing.T) { _ = b.B() }\n',
			"b/b.go": 'package b\nimport "../a"\nfunc B() int { return a.A() }\n',
		},
		(dir) => {
			const e = cycleError(() => compilePackageTests(resolve(dir, "a")));
			assertContains(e.message, "a imports b imports a");
		},
	);
});

test("an edit that removes the cycle compiles again", () => {
	withTempDir(
		{
			"a/a.go": 'package a\nimport "../b"\nvar A = b.B\n',
			"b/b.go": 'package b\nimport "../a"\nvar B = a.A\n',
		},
		(dir) => {
			cycleError(() => compileDir(resolve(dir, "a")));
		},
	);
	withTempDir(
		{
			"a/a.go": 'package a\nimport "../b"\nvar A = b.B\n',
			"b/b.go": "package b\nvar B = 1\n",
		},
		(dir) => {
			const res = compileDir(resolve(dir, "a"));
			assertEqual(res.pkgName, "a");
		},
	);
});

test("gofront check reports cycle members as failed, not skipped", () => {
	withTempDir(
		{
			"a/a.go": 'package a\nimport "../b"\nvar A = b.B\n',
			"b/b.go": 'package b\nimport "../a"\nvar B = a.A\n',
			"c/c.go": "package c\nvar C = 1\n",
		},
		(dir) => {
			const res = handleCheck(`${dir}/...`);
			const status = (n) =>
				res.packages.find((p) => p.dir.endsWith(`/${n}`))?.status;
			assertEqual(status("a"), "fail");
			assertEqual(status("b"), "fail");
			assertEqual(status("c"), "ok");
			for (const n of ["a", "b"]) {
				const p = res.packages.find((x) => x.dir.endsWith(`/${n}`));
				assertContains(p.errors, "import cycle not allowed");
			}
		},
	);
});

test("a three-layer diamond compiles each package once", () => {
	withTempDir(
		{
			"main.go":
				'package main\nimport "./left"\nimport "./right"\nfunc main() { _ = left.L + right.R }\n',
			"left/left.go": 'package left\nimport "../base"\nvar L = base.B\n',
			"right/right.go": 'package right\nimport "../base"\nvar R = base.B\n',
			"base/base.go": 'package base\nimport "../leaf"\nvar B = leaf.F\n',
			"leaf/leaf.go": "package leaf\nvar F = 1\n",
		},
		(dir) => {
			const packageCompiles = new Map();
			compileDir(dir, { packageCompiles });
			assertEqual(packageCompiles.size, 5);
			for (const [pkg, n] of packageCompiles)
				assertEqual([pkg, n].join(":"), `${pkg}:1`);
		},
	);
});
