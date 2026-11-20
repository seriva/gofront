// GoFront test suite — builtin argument counts

import {
	assertAllTargetsOutput,
	assertErrorContains,
	compile,
	section,
	summarize,
	test,
} from "../helpers.js";

section("Builtins — argument count");

const TARGETS = ["js", "both", "wasm"];

// [call, setup, message]
const ARITY_REJECTS = [
	["clear()", "", "not enough arguments for clear() (expected 1, found 0)"],
	["len()", "", "not enough arguments for len() (expected 1, found 0)"],
	["cap()", "", "not enough arguments for cap() (expected 1, found 0)"],
	[
		"copy(s)",
		"s := []int{1}",
		"not enough arguments for copy(s) (expected 2, found 1)",
	],
	["append()", "", "not enough arguments for append() (expected 1, found 0)"],
	["panic()", "", "not enough arguments for panic() (expected 1, found 0)"],
	["new()", "", "not enough arguments for new() (expected 1, found 0)"],
	["make()", "", "not enough arguments for make() (expected 1, found 0)"],
	["min()", "", "not enough arguments for min() (expected 1, found 0)"],
	["max()", "", "not enough arguments for max() (expected 1, found 0)"],
	[
		"delete(m)",
		"m := map[int]int{}",
		"not enough arguments for delete(m) (expected 2, found 1)",
	],
	[
		"complex(1)",
		"",
		"not enough arguments for complex(1) (expected 2, found 1)",
	],
	["real()", "", "not enough arguments for real() (expected 1, found 0)"],
	["imag()", "", "not enough arguments for imag() (expected 1, found 0)"],
	[
		'len("a", "b")',
		"",
		'too many arguments for len("a", "b") (expected 1, found 2)',
	],
	[
		"cap(s, s)",
		"s := []int{1}",
		"too many arguments for cap(s, s) (expected 1, found 2)",
	],
	[
		"copy(s, s, s)",
		"s := []int{1}",
		"too many arguments for copy(s, s, s) (expected 2, found 3)",
	],
	[
		"delete(m, 1, 2)",
		"m := map[int]int{}",
		"too many arguments for delete(m, 1, 2) (expected 2, found 3)",
	],
	[
		"new(int, int)",
		"",
		"too many arguments for new(int, int) (expected 1, found 2)",
	],
	[
		"panic(1, 2)",
		"",
		"too many arguments for panic(1, 2) (expected 1, found 2)",
	],
	["recover(1)", "", "too many arguments for recover(1) (expected 0, found 1)"],
	[
		"clear(s, s)",
		"s := []int{1}",
		"too many arguments for clear(s, s) (expected 1, found 2)",
	],
	[
		"complex(1, 2, 3)",
		"",
		"too many arguments for complex(1, 2, 3) (expected 2, found 3)",
	],
	[
		"real(1i, 2i)",
		"",
		"too many arguments for real(1i, 2i) (expected 1, found 2)",
	],
	[
		"imag(1i, 2i)",
		"",
		"too many arguments for imag(1i, 2i) (expected 1, found 2)",
	],
];

for (const [call, setup, msg] of ARITY_REJECTS) {
	test(`${call} is rejected on every target`, () => {
		for (const target of TARGETS) {
			const { errors } = compile(
				`package main
func main() {
	${setup}
	${call}
}`,
				{ target },
			);
			assertErrorContains(errors, msg);
		}
	});
}

test("builtins with the right count still compile", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	s := []int{1, 2, 3}
	d := make([]int, 2)
	m := map[int]int{1: 1}
	delete(m, 1)
	fmt.Println(len(s), cap(s), copy(d, s), len(append(s)), min(3, 1), max(1.5, 2))
	fmt.Println(real(complex(1, 2)), imag(complex(1, 2)), *new(int))
	clear(s)
	fmt.Println(s, len(m))
}`,
		"3 3 2 3 1 2\n1 2 0\n[0 0 0] 0\n",
	);
});

summarize();
