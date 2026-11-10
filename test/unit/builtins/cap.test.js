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
	[
		"cap of a struct",
		"package main\ntype S struct{}\nfunc main() {\n\tvar s S\n\t_ = cap(s)\n}",
		"invalid argument: s (variable of type S) for cap",
	],
	["cap of a func", body("\tf := func() {}\n\t_ = cap(f)"), "for cap"],
	[
		"cap of a pointer to a struct",
		"package main\ntype S struct{}\nfunc main() {\n\tp := &S{}\n\t_ = cap(p)\n}",
		"for cap",
	],
	[
		"cap of a type parameter with a map core type",
		"package main\nfunc f[M ~map[string]int](m M) int { return cap(m) }\nfunc main() {}",
		"for cap",
	],
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

type L []int

type A [3]int

func main() {
	s := make([]int, 2, 5)
	var arr [4]int
	l := make(L, 1, 6)
	var a A
	fmt.Println(cap(s), cap(arr), cap(&arr), capOf(s), cap(l), cap(&a))
}
`,
		"5 4 4 5 6 3\n",
	);
});
