// test/unit/types/switch-cases.test.js
// Switch case checks: an untyped-bool tag still checks its cases, and a
// tagless switch rejects `case nil`.

import {
	assertAllTargetsOutput,
	assertErrorContains,
	compile,
	compileWasm,
	section,
	test,
} from "../helpers.js";

section("Switch case checks");

function errorsOn(target, src) {
	if (target === "wasm") return compileWasm(src).errors ?? [];
	return compile(src, { target }).errors ?? [];
}

const NEGATIVE = [
	[
		"switch true { case 5: }",
		"package main\nfunc main() {\n\tswitch true {\n\tcase 5:\n\t}\n}",
		"cannot convert 5 (untyped int constant) to type bool",
	],
	[
		"switch { case nil: }",
		"package main\nfunc main() {\n\tswitch {\n\tcase nil:\n\t}\n}",
		"cannot convert nil to type bool",
	],
];

for (const [name, src, want] of NEGATIVE) {
	for (const target of ["js", "both", "wasm"]) {
		test(`${name} is rejected (${target})`, () => {
			assertErrorContains(errorsOn(target, src), want);
		});
	}
}

test("untyped-bool tag and tagless cases stay valid on all targets", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	x := 3
	switch true {
	case 1 > 0:
		fmt.Println("a")
	}
	switch false {
	case x > 5:
		fmt.Println("b")
	}
	switch {
	case x > 0:
		fmt.Println("c")
	}
}
`,
		"a\nb\nc\n",
	);
});
