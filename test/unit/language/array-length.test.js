// GoFront test suite — array lengths, indexes and make sizes are integer constants

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	assertErrorContains,
	compile,
	compileWasm,
	section,
	summarize,
	test,
} from "../helpers.js";

function errorsOn(target, src) {
	if (target === "wasm") return compileWasm(src).errors ?? [];
	return compile(src, { target }).errors ?? [];
}

const TARGETS = ["js", "both", "wasm"];

function program(body, decls = "") {
	return `package main

import "fmt"
import "math"

const N = 3

${decls}
func main() {
	_ = math.MaxInt8
	${body}
	fmt.Println("ok")
}
`;
}

section("Array length: only integer constants are accepted");

for (const [name, body, decls] of [
	["[1 == 1]int", "var a [1 == 1]int\n\t_ = a"],
	["a string length", 'var a ["a"]int\n\t_ = a'],
	["a nil length", "var a [nil]int\n\t_ = a"],
	["a bool constant", "const c = true\n\tvar a [c]int\n\t_ = a"],
	["a float length 2.5", "var a [2.5]int\n\t_ = a"],
	["a typed float constant", "const c float64 = 2\n\tvar a [c]int\n\t_ = a"],
	["a complex length", "var a [2i]int\n\t_ = a"],
	["a composite literal [1 == 1]int{}", "a := [1 == 1]int{}\n\t_ = a"],
	["a defined array type", "", "type A [1 == 1]int\n"],
]) {
	for (const target of TARGETS) {
		test(`${name} is rejected (${target})`, () => {
			assertErrorContains(
				errorsOn(target, program(body, decls)),
				"invalid array length",
			);
		});
	}
}

for (const [name, body, want] of [
	["[2.0]int", "var a [2.0]int\n\tfmt.Println(len(a))", "2\nok\n"],
	["['\\x03']int", "var a ['\\x03']int\n\tfmt.Println(len(a))", "3\nok\n"],
	["[N * 2]int", "var a [N * 2]int\n\tfmt.Println(len(a))", "6\nok\n"],
	[
		"[math.MaxInt8]byte",
		"var a [math.MaxInt8]byte\n\tfmt.Println(len(a))",
		"127\nok\n",
	],
]) {
	test(`${name} keeps its length (js, both, wasm)`, async () => {
		await assertAllTargetsOutput(program(body), want);
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
