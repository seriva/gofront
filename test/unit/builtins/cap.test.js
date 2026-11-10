// test/unit/builtins/cap.test.js
// `cap` accepts only slices, arrays, pointers to arrays and channels.

import {
	assertAllTargetsOutput,
	assertErrorContains,
	compile,
	compileWasm,
	section,
	test,
} from "../helpers.js";

section("cap operand checks");

function errorsOn(target, src) {
	if (target === "wasm") return compileWasm(src).errors ?? [];
	return compile(src, { target }).errors ?? [];
}

const body = (s) => `package main\nfunc main() {\n${s}\n}`;

const NEGATIVE = [
	[
		"cap(1)",
		body("\t_ = cap(1)"),
		"invalid argument: 1 (untyped int constant) for cap",
	],
	["cap(true)", body("\t_ = cap(true)"), "for cap"],
	["cap of an int variable", body("\tn := 3\n\t_ = cap(n)"), "for cap"],
];

for (const [name, src, want] of NEGATIVE) {
	for (const target of ["js", "both", "wasm"]) {
		test(`${name} is rejected (${target})`, () => {
			assertErrorContains(errorsOn(target, src), want);
		});
	}
}

test("cap of slice, array, array pointer and generic slice stays valid", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func capOf[S ~[]E, E any](s S) int { return cap(s) }

func main() {
	s := make([]int, 2, 5)
	var arr [4]int
	fmt.Println(cap(s), cap(arr), cap(&arr), capOf(s))
}
`,
		"5 4 4 5\n",
	);
});
