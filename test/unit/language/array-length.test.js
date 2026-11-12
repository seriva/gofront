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

section("Index and make size: only integer constants are accepted");

const SLICE = "s := []int{1, 2, 3}\n\t_ = s\n\t";

for (const [name, body] of [
	["s[1 == 1]", "_ = s[1 == 1]"],
	['s["a"]', '_ = s["a"]'],
	["s[nil]", "_ = s[nil]"],
	["s[1.5]", "_ = s[1.5]"],
	["a typed float constant index", "const c float64 = 1\n\t_ = s[c]"],
	["an array index a[1 == 1]", "var a [3]int\n\t_ = a[1 == 1]"],
	["a string index", '_ = "abc"[1 == 1]'],
	["a slice bound s[1 == 1 : 2]", "_ = s[1 == 1 : 2]"],
	["make([]int, 1 == 1)", "_ = make([]int, 1 == 1)"],
	['make([]int, "a")', '_ = make([]int, "a")'],
	["make([]int, 2, 1.5)", "_ = make([]int, 2, 1.5)"],
	["make([]int, 2i)", "_ = make([]int, 2i)"],
	['make(map[string]int, "a")', '_ = make(map[string]int, "a")'],
]) {
	for (const target of TARGETS) {
		test(`${name} is rejected (${target})`, () => {
			assertErrorContains(
				errorsOn(target, program(`${SLICE}${body}`)),
				"must be integer",
			);
		});
	}
}

for (const [name, body, want] of [
	["s[1.0]", "fmt.Println(s[1.0])", "2\nok\n"],
	["s['\\x01']", "fmt.Println(s['\\x01'])", "2\nok\n"],
	["s[N - 1]", "fmt.Println(s[N-1])", "3\nok\n"],
	["s[1.0:2.0]", "fmt.Println(s[1.0:2.0])", "[2]\nok\n"],
	["make([]int, 2.0)", "fmt.Println(len(make([]int, 2.0)))", "2\nok\n"],
	["make([]int, 1, 2.0)", "fmt.Println(cap(make([]int, 1, 2.0)))", "2\nok\n"],
	[
		"a map keyed by a bool constant",
		"m := map[bool]int{true: 4}\n\tfmt.Println(m[1 == 1])",
		"4\nok\n",
	],
]) {
	test(`${name} runs (js, both, wasm)`, async () => {
		await assertAllTargetsOutput(program(`${SLICE}${body}`), want);
	});
}

section("Index and make size: a typed operand must be an integer");

const TYPED = "s := []int{1, 2, 3}\n\tvar a [3]int\n\t_, _ = s, a\n\t";

for (const [name, body] of [
	["s[f] with a float64", "f := 1.5\n\t_ = s[f]"],
	["a[f] = 2 with a float64", "f := 1.5\n\ta[f] = 2"],
	["a string index by a float64", 'f := 1.5\n\t_ = "abc"[f]'],
	["s[:f]", "f := 1.5\n\t_ = s[:f]"],
	["s[0:1:f]", "f := 1.5\n\t_ = s[0:1:f]"],
	["make([]int, f)", "f := 1.5\n\t_ = make([]int, f)"],
	["make([]int, 1, f)", "f := 1.5\n\t_ = make([]int, 1, f)"],
	["make(map[string]int, f)", "f := 1.5\n\t_ = make(map[string]int, f)"],
	["a float32 index", "var f float32 = 1\n\t_ = s[f]"],
	["a complex128 index", "var f complex128 = 1\n\t_ = s[f]"],
	["a string index", 'f := "a"\n\t_ = s[f]'],
	["a bool index", "f := true\n\t_ = s[f]"],
	["an any index", "var f any = 1\n\t_ = s[f]"],
	["a bool comparison index", "x := 1\n\t_ = s[x == 1]"],
	["a defined float index", "type F float64\n\tvar f F = 1\n\t_ = s[f]"],
]) {
	for (const target of TARGETS) {
		test(`${name} is rejected (${target})`, () => {
			assertErrorContains(
				errorsOn(target, program(`${TYPED}${body}`)),
				"must be integer",
			);
		});
	}
}

test("an integer index of any integer type runs (js, both, wasm)", async () => {
	await assertAllTargetsOutput(
		program(
			`${TYPED}type MyI int
	var u8 uint8 = 1
	var my MyI = 2
	var b byte = 0
	r := 'a' - 'a' + 1
	m := map[float64]string{1.5: "x"}
	f := 1.5
	fmt.Println(s[u8], s[my], s[b], s[r], s[:my], make([]int, u8), m[f])`,
		),
		"2 3 1 2 [1 2] [0] x\nok\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
