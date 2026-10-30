// GoFront test suite — package targets and diagnostics

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileDir, compileSingleFile } from "../../../src/compiler.js";
import { Lexer } from "../../../src/lexer/lexer.js";
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

test("wasm package allows defer statements", () => {
	const src = `//gofront:target wasm
package physics

func Cleanup() {
	defer Cleanup()
}
`;
	const { errors } = compile(src);
	assert(!errors || errors.length === 0);
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

import "regexp"

func F() bool { return regexp.MustCompile("a").MatchString("a") }
`;
	const err = compileTemp({ "m.go": src });
	assertContains(err, "'regexp' is not yet available in wasm packages");
	assertContains(err, "1 unsupported stdlib import (regexp)");
});

test("wasm package rejects removed fmt.Scan", () => {
	const src = `//gofront:target wasm
package m

import "fmt"

func F() { fmt.Scan(nil) }
`;
	const err = compileTemp({ "m.go": src });
	assertContains(err, "No member 'Scan' in namespace fmt");
});

test("wasm package rejects time.Sleep with targeted diagnostic", () => {
	const src = `//gofront:target wasm
package m

import "time"

func F() { time.Sleep(100 * time.Millisecond) }
`;
	const err = compileTemp({ "m.go": src });
	assertContains(err, "'time.Sleep' is not yet available in wasm packages");
	assertContains(err, "move this call to a JS package");
});

test("wasm package accepts supported strings/strconv members", () => {
	const src = `//gofront:target wasm
package m

import (
	"strconv"
	"strings"
)

func F(s string) string { return strings.ToUpper(strings.TrimSpace(s)) + strconv.Itoa(len(s)) }
`;
	const err = compileTemp({ "m.go": src });
	assertEqual(err, "");
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

test("js package calling a wasm package inside a loop gets a boundary hint", () => {
	const warnings = [];
	const origErr = console.error;
	console.error = (msg) => warnings.push(String(msg));
	let err;
	try {
		err = compileTemp({
			"main.go": `package main

import "./phys"

func Main() int32 {
	var total int32
	for i := int32(0); i < 10; i++ {
		total += phys.Step(i)
	}
	return total + phys.Step(1)
}
`,
			"phys/phys.go":
				"//gofront:target wasm\npackage phys\n\nfunc Step(x int32) int32 { return x * 2 }\n",
		});
	} finally {
		console.error = origErr;
	}
	assertEqual(err, "");
	const text = warnings.join("\n");
	assertContains(
		text,
		"'phys.Step' crosses the JS→WASM boundary inside a loop",
	);
	assertContains(text, "move the loop into the wasm package");
	assertEqual(
		warnings.filter((w) => w.includes("crosses the JS→WASM boundary")).length,
		1,
	);
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

section("compiler — import and precision diagnostics");

test("an unavailable stdlib package in a wasm or both package gets one error", () => {
	for (const [target, pkg] of [
		["wasm", "reflect"],
		["both", "unsafe"],
	]) {
		const err = compileTemp({
			"main.go": `//gofront:target ${target}\npackage main\n\nimport "${pkg}"\n\nfunc main() {}\n`,
		});
		assertContains(err, `package '${pkg}' is not available`);
		assertEqual(err.split("Type error").length - 1, 1);
		assert(!err.includes("js: imports"), err);
	}
});

test("a js: import in a wasm package is still rejected", () => {
	const err = compileTemp({
		"main.go":
			'//gofront:target wasm\npackage main\n\nimport "js:./x.d.ts"\n\nfunc main() {}\n',
		"x.d.ts": "export declare const x: number;\n",
	});
	assertContains(err, "js: imports are not allowed in wasm packages");
});

test("an integer literal beyond 2^53 warns in js output", () => {
	const msgs = (src) => compile(src).warnings;
	for (const src of [
		"package main\n\nconst c = 9007199254740993\n\nfunc main() { println(c) }\n",
		"package main\n\nfunc main() { x := 9007199254740993; println(x) }\n",
		"package main\n\nfunc main() { println(0x20000000000001) }\n",
		"package main\n\nfunc main() { y := 1; println(y + 9007199254740993) }\n",
	]) {
		const w = msgs(src);
		assertEqual(
			w.filter((m) => m.includes("exceeds JS Number precision")).length,
			1,
		);
		assertContains(
			w.join("\n"),
			"constant 9007199254740993 exceeds JS Number precision",
		);
	}
});

test("a precision warning repeats when the same package compiles again", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-precision-"));
	const logged = [];
	const origErr = console.error;
	try {
		writeFileSync(
			join(dir, "main.go"),
			"package main\n\nvar g float64 = 1<<53 + 1\n\nfunc main() { println(g) }\n",
		);
		writeFileSync(join(dir, "other.go"), "package main\n\nvar h = 1\n");
		console.error = (m) => logged.push(String(m));
		for (let i = 0; i < 2; i++) compileDir(dir);
	} finally {
		console.error = origErr;
		rmSync(dir, { recursive: true, force: true });
	}
	assertEqual(
		logged.filter((m) => m.includes("exceeds JS Number precision")).length,
		2,
	);
});

test("exact integer literals stay quiet", () => {
	const { warnings } = compile(
		"package main\n\nfunc main() { println(9007199254740992, 1<<62, 123) }\n",
	);
	assertEqual(warnings.join("\n"), "");
});
