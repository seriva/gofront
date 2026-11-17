// GoFront test suite — compile errors of a dependency name its package

import { resolve } from "node:path";
import { CompileError } from "../../../src/compiler.js";
import {
	assert,
	assertEqual,
	compileDir,
	section,
	test,
	withTempDir,
} from "../helpers.js";

section("compiler.js — dependency failure attribution");

function catchErr(fn) {
	try {
		fn();
	} catch (e) {
		return e;
	}
	return null;
}

test("a failing local dependency tags the CompileError with its directory", () => {
	withTempDir(
		{
			"a/a.go": 'package a\nvar X int = "s"\n',
			"c/c.go": 'package c\nimport "../a"\nvar Z = a.X\n',
		},
		(dir) => {
			const e = catchErr(() => compileDir(resolve(dir, "c")));
			assert(e instanceof CompileError, "CompileError");
			assertEqual(e.packageDir, resolve(dir, "a"));
			assert(e.message.includes("a.go"), "message names the dependency file");
			assertEqual(e.message, e.errors.map((x) => x.message).join("\n"));
		},
	);
});

test("a package's own errors carry no packageDir", () => {
	withTempDir({ "a/a.go": 'package a\nvar X int = "s"\n' }, (dir) => {
		const e = catchErr(() => compileDir(resolve(dir, "a")));
		assertEqual(e.packageDir, undefined);
	});
});
