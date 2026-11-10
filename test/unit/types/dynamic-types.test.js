// test/unit/types/dynamic-types.test.js
// Dynamic types of func, slice and map values boxed into `any`.

import { assertAllTargetsOutput, section, test } from "../helpers.js";

section("Dynamic func and slice types");

test("defined func type is not an unnamed func; nil defined slice keeps its type", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type G func(s string) string
type S []int

func main() {
	_, ok := any(func(s string) string { return s }).(G)
	_, ok2 := any(S(nil)).(S)
	fmt.Println(ok, ok2)
}
`,
		"false true\n",
	);
});

test("converting a func to a defined type does not tag the shared func", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type G func(s string) string

func id(s string) string { return s }

func main() {
	var a any = G(id)
	var b any = id
	_, ok1 := a.(G)
	_, ok2 := b.(G)
	fmt.Println(ok1, ok2)
}
`,
		"true false\n",
	);
});
