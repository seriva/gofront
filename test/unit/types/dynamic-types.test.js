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

section("Multi-value calls forwarded into interface parameters");

const SHOW = `func show(v any, n int) {
	_, ok := v.(T)
	fmt.Println(v, n, ok)
}
`;

test("g(f()) boxes a forwarded struct into an any parameter by value", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

${FWD_PRELUDE}
${SHOW}
func main() {
	show(makePair())
}
`,
		"{1} 1 true\n",
	);
});

test("a method call forwarding f() boxes the struct into an any parameter", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

${FWD_PRELUDE}
type O struct{}

func (O) show(v any, n int) {
	_, ok := v.(T)
	fmt.Println(v, n, ok)
}

func main() {
	O{}.show(makePair())
}
`,
		"{1} 1 true\n",
	);
});

test("fmt.Println and defer keep forwarding multi-value calls", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

${FWD_PRELUDE}
${SHOW}
func main() {
	defer show(makePair())
	fmt.Println(makePair())
}
`,
		"{1} 1\n{1} 1 true\n",
	);
});

test("g(f()) forwards into an any parameter from assignments and returns", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

${FWD_PRELUDE}
func box(v any, n int) any {
	_, ok := v.(T)
	return fmt.Sprint(v, n, ok)
}

func pass() any { return box(makePair()) }

func main() {
	s := box(makePair())
	var t any = box(makePair())
	s = box(makePair())
	fmt.Println(s, t, pass())
}
`,
		"{1} 1 true {1} 1 true {1} 1 true\n",
	);
});

test("g(f()) nested in a larger expression boxes the forwarded struct", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

${FWD_PRELUDE}
func check(v any, n int) bool {
	t, ok := v.(T)
	return ok && t.A == 1 && n == 1
}

func wrap(b bool) bool { return b }

func pair() (T, int) {
	fmt.Println("pair")
	return makePair()
}

func side() bool {
	fmt.Println("side")
	return true
}

type O struct{}

func (O) check(v any, n int) bool {
	_, ok := v.(T)
	return ok && n == 1
}

var g = check(makePair())

func main() {
	if check(makePair()) {
		fmt.Println("ok")
	} else {
		fmt.Println("fail")
	}
	fmt.Println(g, wrap(check(makePair())))
	fmt.Println(check(pair()) && side())
	fmt.Println(wrap(O{}.check(makePair())))
}
`,
		"ok\ntrue true\npair\nside\ntrue\ntrue\n",
	);
});

section("Array values in an interface");

test("arrays in an any compare element by element", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P struct{ X, Y int }

func main() {
	var k, k2 any = [2]int{1, 2}, [2]int{1, 2}
	fmt.Println(k == k2)
	var a, b any = [1]P{{1, 2}}, [1]P{{1, 2}}
	fmt.Println(a == b)
	var c, d any = [2]int{1, 2}, [2]int{1, 3}
	fmt.Println(c == d, c != d)
	var e, f any = [2]int{1, 2}, [2]int32{1, 2}
	fmt.Println(e == f)
	var s, t any = [2]string{"a", "b"}, [2]string{"a", "b"}
	var u, v any = [3]int{1, 2, 3}, [2]int{1, 2}
	fmt.Println(s == t, u == v, k == s)
}
`,
		"true\ntrue\nfalse true\nfalse\ntrue false false\n",
	);
});
