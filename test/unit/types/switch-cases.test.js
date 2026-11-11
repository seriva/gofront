// test/unit/types/switch-cases.test.js
// Switch case checks: an untyped-bool tag still checks its cases, and a
// switch on a non-nilable tag (tagless or not) rejects `case nil`.

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
	[
		"switch true { case nil: }",
		"package main\nfunc main() {\n\tswitch true {\n\tcase nil:\n\t}\n}",
		"cannot convert nil to type bool",
	],
	[
		"switch n { case nil: } on int",
		"package main\nfunc main() {\n\tn := 1\n\tswitch n {\n\tcase nil:\n\t}\n}",
		"cannot convert nil to type int",
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

test("case nil on nilable tags stays valid on all targets", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	var e error
	switch e {
	case nil:
		fmt.Println("e nil")
	}
	var p *int
	switch p {
	case nil:
		fmt.Println("p nil")
	}
	var s []int
	switch s {
	case nil:
		fmt.Println("s nil")
	}
	var f func()
	switch f {
	case nil:
		fmt.Println("f nil")
	}
}
`,
		"e nil\np nil\ns nil\nf nil\n",
	);
});
