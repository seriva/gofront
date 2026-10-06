// GoFront test suite — package targets and diagnostics

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileSingleFile } from "../../../src/compiler.js";
import { Lexer } from "../../../src/lexer.js";
import { Parser } from "../../../src/parser/index.js";
import { TypeChecker } from "../../../src/typechecker/index.js";
import {
	assert,
	assertContains,
	assertEqual,
	compile,
	section,
	test,
} from "../helpers.js";

// Writes `files` into a temp dir, compiles main.go (or the only file) and returns the error text.
function compileTemp(files) {
	const dir = mkdtempSync(join(tmpdir(), "gofront-targets-"));
	try {
		for (const [rel, src] of Object.entries(files)) {
			mkdirSync(dirname(join(dir, rel)), { recursive: true });
			writeFileSync(join(dir, rel), src);
		}
		const entry = files["main.go"] ? "main.go" : Object.keys(files)[0];
		compileSingleFile(join(dir, entry));
		return "";
	} catch (e) {
		return e.message;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

section("compiler — target directives & lexer/parser");

test("lexer captures //gofront:target directive", () => {
	const src = `//gofront:target wasm\npackage engine\n`;
	const tokens = new Lexer(src, "engine.go").tokenize();
	assertEqual(tokens.target, "wasm");
});

test("parser passes target to Program node", () => {
	const src = `//gofront:target both\npackage mathx\n`;
	const tokens = new Lexer(src, "mathx.go").tokenize();
	const ast = new Parser(tokens, "mathx.go", src).parse();
	assertEqual(ast.target, "both");
});

section("compiler — target diagnostics");

test("wasm package rejects browser globals with hint", () => {
	const src = `//gofront:target wasm
package physics

func Step() {
	console.log("stepping")
}
`;
	const { errors } = compile(src);
	assert(errors.length > 0, "expected target error for browser global");
	const msg = errors.map((e) => e.message).join("\n");
	assertContains(msg, "'console' is not available in wasm packages");
	assertContains(
		msg,
		"package 'physics' is //gofront:target wasm — browser globals are only available in js packages",
	);
});

test("wasm package allows local variable shadowing browser global", () => {
	const src = `//gofront:target wasm
package physics

func Log(console string) string {
	return console
}
`;
	const { errors } = compile(src);
	assertEqual(errors.length, 0);
});

test("wasm package rejects gom usage", () => {
	const src = `//gofront:target wasm
package physics

func Render() {
	_ = gom
}
`;
	const { errors } = compile(src);
	assert(errors.length > 0);
	const msg = errors.map((e) => e.message).join("\n");
	assertContains(msg, "package 'gom' is not available in wasm packages");
});

test("wasm package rejects defer statements with planned message", () => {
	const src = `//gofront:target wasm
package physics

func Cleanup() {
	defer Cleanup()
}
`;
	const { errors } = compile(src);
	assert(errors.length > 0);
	const msg = errors.map((e) => e.message).join("\n");
	assertContains(
		msg,
		"'defer' is not yet supported in wasm packages (planned)",
	);
});

test("wasm package rejects async function declarations and await", () => {
	const src = `//gofront:target wasm
package physics

async func FetchData() {}
`;
	const { errors } = compile(src);
	assert(errors.length > 0);
	const msg = errors.map((e) => e.message).join("\n");
	assertContains(
		msg,
		"async functions are not supported in wasm packages; keep async code in a js package",
	);
});

test("both package rejects mutable package-level variable", () => {
	const src = `//gofront:target both
package mathx

var scratch = 0

func Touch() {
	scratch = 10
}
`;
	const { errors } = compile(src);
	assert(errors.length > 0);
	const msg = errors.map((e) => e.message).join("\n");
	assertContains(
		msg,
		"package-level variable 'scratch' is mutated; not allowed in 'both' packages (each target gets its own copy)",
	);
});

test("both package allows mutating local variable shadowing package variable", () => {
	const src = `//gofront:target both
package mathx

var scratch = 0

func Touch(scratch int) int {
	scratch++
	return scratch
}
`;
	const { errors } = compile(src);
	assertEqual(errors.length, 0);
});

test("both package detects indirect package-variable mutation", () => {
	const src = `//gofront:target both
package mathx

type V struct{ X int32 }

func (v *V) Bump() { v.X++ }

var G V
var N int32
var M int32

func Touch() {
	G.Bump()
	p := &N
	*p = 5
	if true {
		M := int32(1)
		M++
	}
	M = 2
}
`;
	const { errors } = compile(src);
	const msg = errors.map((e) => e.message).join("\n");
	assertContains(msg, "package-level variable 'G' is mutated");
	assertContains(msg, "package-level variable 'N' is mutated");
	assertContains(msg, "package-level variable 'M' is mutated");
	assertContains(msg, "cannot be both: 3 blockers");
	assert(
		errors.every((e) => e instanceof Error),
		"summary must be an Error instance",
	);
});

test("unknown //gofront:target value is rejected", () => {
	const src = `//gofront:target foo
package m

func F() int32 { return 1 }
`;
	const { errors } = compile(src);
	assertEqual(errors.length, 1);
	assertContains(
		errors[0].message,
		"unknown //gofront:target 'foo' (expected js, wasm or both)",
	);
});

test("//gofront:target after the package clause is rejected", () => {
	const src = `package m
//gofront:target wasm

func F() int32 { return 1 }
`;
	const { errors } = compile(src);
	assertEqual(errors.length, 1);
	assertContains(
		errors[0].message,
		"//gofront:target must appear before the package clause",
	);
});

test("wasm package rejects stdlib the backend does not implement", () => {
	const src = `//gofront:target wasm
package m

import "strings"

func F() int { return len(strings.ToUpper("a")) }
`;
	const err = compileTemp({ "m.go": src });
	assertContains(err, "'strings' is not yet available in wasm packages");
	assertContains(err, "1 unsupported stdlib import (strings)");
});

test("wasm package cannot import a js package", () => {
	const err = compileTemp({
		"main.go": `//gofront:target wasm
package main

import "./ui"

func Main() int { return ui.N }
`,
		"ui/ui.go": "package ui\n\nvar N = 1\n",
	});
	assertContains(err, "package 'main' (wasm) cannot import 'ui' (js)");
});

test("both package cannot import a wasm package", () => {
	const err = compileTemp({
		"main.go": `//gofront:target both
package mathx

import "./col"

var N = col.N
`,
		"col/col.go": "//gofront:target wasm\npackage col\n\nvar N = 2\n",
	});
	assertContains(
		err,
		"package 'mathx' (both) can only import 'both' packages; 'col' is wasm",
	);
	assertContains(err, "1 blocker — 1 wasm package import (col)");
});

test("typechecker generates summary diagnostic line with blockers count", () => {
	const checker = new TypeChecker();
	checker.target = "wasm";
	checker.pkgName = "physics";
	checker.recordBlocker("browser global", "console");
	checker.recordBlocker("async function", "Fetch");
	checker.recordBlocker("defer statement");
	const summary = checker.getSummary();
	assertContains(
		summary,
		"package 'physics' cannot be wasm: 3 blockers — 1 browser global (console), 1 async function (Fetch), 1 defer statement",
	);
});
