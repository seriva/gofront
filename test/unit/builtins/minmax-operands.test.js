// GoFront test suite — min/max/make operand checks

import {
	assertAllTargetsOutput,
	assertErrorContains,
	compile,
	section,
	summarize,
	test,
} from "../helpers.js";

section("Builtins — min/max/make operands");

const TARGETS = ["js", "both", "wasm"];

// [name, body, message]
const REJECTS = [
	[
		"earlier untyped int overflows a later typed byte",
		"var b byte\n\t_ = min(1, 300, b)",
		"300 (untyped int constant) overflows",
	],
	[
		"earlier untyped float truncates to a later typed int",
		"var a int\n\t_ = min(1.5, 2.0, a)",
		"1.5 (untyped float constant) truncated to int",
	],
	[
		"nil cannot be ordered",
		"var x any = min(nil, 1)\n\t_ = x",
		"invalid argument: nil cannot be ordered",
	],
	["a void call cannot be ordered", "_ = min(v(), v())", "cannot be ordered"],
	[
		"slice make takes at most three arguments",
		"_ = make([]int, 1, 2, 3)",
		"make([]int, 1, 2, 3) expects 2 or 3 arguments; found 4",
	],
	[
		"map make takes at most two arguments",
		"_ = make(map[int]int, 1, 2)",
		"make(map[int]int, 1, 2) expects 1 or 2 arguments; found 3",
	],
];

for (const [name, body, msg] of REJECTS) {
	test(`${name} on every target`, () => {
		for (const target of TARGETS) {
			const { errors } = compile(
				`package main
func v() {}
func main() {
	${body}
}`,
				{ target },
			);
			assertErrorContains(errors, msg);
		}
	});
}

const TP_REJECTS = [
	[
		"~int",
		"min(a, 1.5)",
		"cannot convert 1.5 (untyped float constant) to type T",
	],
	[
		"~int",
		"min(1.5, a)",
		"cannot convert 1.5 (untyped float constant) to type T",
	],
	[
		"~int8",
		"min(a, 200)",
		"cannot convert 200 (untyped int constant) to type T",
	],
	[
		"~int | ~float64",
		"min(a, 1.5)",
		"cannot convert 1.5 (untyped float constant) to type T",
	],
	[
		"~string",
		"min(a, 1)",
		"mismatched types T (previous argument) and untyped int (type of 1)",
	],
	[
		"~int | ~string",
		"min(a, 1)",
		"mismatched types T (previous argument) and untyped int (type of 1)",
	],
];

for (const [constraint, call, msg] of TP_REJECTS) {
	test(`${call} with ${constraint} is rejected on every target`, () => {
		for (const target of TARGETS) {
			const { errors } = compile(
				`package main
func f[T interface{ ${constraint} }](a T) T { return ${call} }
func main() {}`,
				{ target },
			);
			assertErrorContains(errors, msg);
		}
	});
}

test("min of untyped int and rune is a rune", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	x := min(1, 'a')
	y := max('a', 1, 2.5)
	fmt.Printf("%T %v %T %v\\n", x, x, y, y)
}`,
		"int32 1 float64 97\n",
	);
});

summarize();
