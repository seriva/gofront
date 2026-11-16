// GoFront test suite — the unit-test helpers themselves

import { join } from "node:path";
import { CompileError } from "../../../src/compiler.js";
import {
	assert,
	assertContains,
	assertEqual,
	assertErrorContains,
	assertThrows,
	compile,
	FIXTURES,
	firstDiff,
	runProgram,
	section,
	test,
	toCompileResult,
} from "../helpers.js";

section("compile() on the production path");

test("a type error comes back in errors with the fixture basename", () => {
	const { errors } = compile('package main\nfunc main() { var x int = "s" }', {
		fromFile: join(FIXTURES, "type_alias_test.go"),
	});
	assertContains(errors[0]?.message ?? "", "type_alias_test.go");
});

test("a parse error comes back in errors instead of throwing", () => {
	const { js, errors } = compile("package main\nfunc main() { goto }");
	assertEqual(js, null);
	assertErrorContains(errors, "expected");
});

test("warnings are returned", () => {
	const { warnings } = compile(
		"package main\nfunc main() {\n\tvar x int = 9007199254740993\n\t_ = x\n}\n",
		{ target: "js" },
	);
	assert(
		warnings.some((w) => w.includes("2^53") || w.includes("precision")),
		`warnings: ${warnings.join("|")}`,
	);
});

section("toCompileResult");

test("a CompileError becomes errors", () => {
	const { res, errors } = toCompileResult(() => {
		throw new CompileError([new Error("boom")]);
	});
	assertEqual(res, null);
	assertEqual(errors.length, 1);
	assertEqual(errors[0].message, "boom");
});

test("a non-CompileError exception propagates", () => {
	assertThrows(
		() =>
			toCompileResult(() => {
				throw new TypeError("crash");
			}),
		"crash",
	);
});

section("firstDiff and runProgram");

test("firstDiff names the first differing line", () => {
	assertEqual(firstDiff("a\nb", "a\nc"), 'line 2: want "b", got "c"');
});

test("firstDiff reports <EOF> on a length mismatch", () => {
	assertEqual(firstDiff("a\nb", "a"), 'line 2: want "b", got "<EOF>"');
	assertEqual(firstDiff("a", "a\nb"), 'line 2: want "<EOF>", got "b"');
});

const HELLO = 'package main\n\nfunc main() { println("hello") }\n';

for (const target of ["js", "both", "wasm"]) {
	test(`runProgram returns stdout for target ${target}`, async () => {
		assertEqual(await runProgram(HELLO, { target }), "hello\n");
	});
}
