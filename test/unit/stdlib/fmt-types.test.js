// test/unit/stdlib/fmt-types.test.js
// `fmt` `%T` of types instantiated in generic code.

import { assertAllTargetsOutput, section, test } from "../helpers.js";

section("fmt %T of generic instantiations");

test("%T of maps instantiated in generic code prints Go's type", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func pair[K comparable, V any](k K, v V) any { return map[K]V{k: v} }

func main() {
	fmt.Printf("%T %T\\n", pair(1, []int{2}), pair("s", 5))
}
`,
		"map[int][]int map[string]int\n",
	);
});

test("%T of a map parameter in generic code prints Go's type", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func show[K comparable, V any](m map[K]V) {
	fmt.Printf("%T %v\\n", m, m)
}

func main() {
	show(map[string]int{"a": 1})
	show(map[int][]string{2: {"x"}})
}
`,
		"map[string]int map[a:1]\nmap[int][]string map[2:[x]]\n",
	);
});
