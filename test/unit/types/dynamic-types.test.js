// test/unit/types/dynamic-types.test.js
// Dynamic types of func, slice and map values boxed into `any`.

import {
	assertAllTargetsOutput,
	assertProgramOutput,
	section,
	test,
} from "../helpers.js";

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

section("Dynamic types of maps built in generic code");

const SWITCH = `
func kind(v any) string {
	switch v.(type) {
	case map[int]int:
		return "ii"
	case map[int][]int:
		return "ia"
	case map[string]int:
		return "si"
	}
	return "?"
}
`;

test("a map literal built in a generic function keeps its instantiated type in an any", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func pair[K comparable, V any](k K, v V) any { return map[K]V{k: v} }
${SWITCH}
func main() {
	fmt.Println(kind(pair(1, 2)), kind(pair(1, []int{2})), kind(pair("s", 5)))
	_, ok := pair("s", 5).(map[string]int)
	_, bad := pair("s", 5).(map[int]int)
	fmt.Println(ok, bad)
}
`,
		"ii ia si\ntrue false\n",
	);
});

test("make(map[K]V) in a generic function keeps its instantiated type in an any", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func mk[K comparable, V any]() any { return make(map[K]V) }
${SWITCH}
func main() {
	fmt.Println(kind(mk[string, int]()), kind(mk[int, int]()), kind(mk[int, []int]()))
}
`,
		"si ii ia\n",
	);
});
