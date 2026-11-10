// test/unit/types/dynamic-types.test.js
// Dynamic types of func, slice and map values boxed into `any`.

import {
	assert,
	assertAllTargetsOutput,
	assertProgramOutput,
	compile,
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

section("Multi-value calls forwarded into interface results");

const FWD_PRELUDE = `type T struct{ A int }

func makePair() (T, int) { return T{1}, 1 }
`;

test("return f() boxes a forwarded struct into an any result by value", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

${FWD_PRELUDE}
func getPair() (any, int) { return makePair() }

func main() {
	v, n := getPair()
	_, ok := v.(T)
	fmt.Printf("%v %T %v %d\\n", v, v, ok, n)
}
`,
		"{1} main.T true 1\n",
	);
});

test("return f() into named any results keeps the forwarded values", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

${FWD_PRELUDE}
func getPair() (v any, n int) { return makePair() }

func main() {
	v, n := getPair()
	_, ok := v.(T)
	fmt.Printf("%v %T %v %d\\n", v, v, ok, n)
}
`,
		"{1} main.T true 1\n",
	);
});

test("return f() in a func literal boxes the forwarded struct", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

${FWD_PRELUDE}
func main() {
	getPair := func() (any, int) { return makePair() }
	v, n := getPair()
	_, ok := v.(T)
	fmt.Printf("%v %T %v %d\\n", v, v, ok, n)
}
`,
		"{1} main.T true 1\n",
	);
});

test("return f() forwards an int into an any result", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func mk() (int, string) { return 7, "s" }

func get() (any, string) { return mk() }

func main() {
	v, s := get()
	_, ok := v.(int)
	fmt.Println(v, s, ok)
}
`,
		"7 s true\n",
	);
});

test("return f() without interface results keeps the direct tuple", async () => {
	const src = `package main

import "fmt"

${FWD_PRELUDE}
func same() (T, int) { return makePair() }

func main() {
	v, n := same()
	fmt.Println(v, n)
}
`;
	await assertAllTargetsOutput(src, "{1} 1\n");
	const { js } = compile(src);
	const start = js.indexOf("function same(");
	const body = js.slice(start, js.indexOf("\n}", start));
	assert(start >= 0 && !body.includes("__fwd$"), `unexpected temps: ${body}`);
});

test("return f() boxes a forwarded named non-struct type into a method interface", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type M int

func (m M) String() string { return fmt.Sprint("m", int(m)) }

func mk() (M, int) { return 3, 1 }

func get() (fmt.Stringer, int) { return mk() }

func main() {
	s, n := get()
	fmt.Println(s.String(), n)
}
`,
		"m3 1\n",
	);
});
