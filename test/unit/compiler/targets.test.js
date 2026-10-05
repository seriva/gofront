// GoFront test suite — package targets and diagnostics

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
