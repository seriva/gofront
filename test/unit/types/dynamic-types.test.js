// test/unit/types/dynamic-types.test.js
// Dynamic types of func, slice and map values boxed into `any`.

import {
	assert,
	assertAllTargetsOutput,
	assertProgramOutput,
	assertWasmProgramOutput,
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

section("Named array and slice identity in an interface");

test("a named array in an any is not the unnamed array", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type A [2]int

func main() {
	var k any = A{1, 2}
	_, ok := k.([2]int)
	var j any = [2]int{1, 2}
	fmt.Println(ok, k == j)
	_, ok2 := k.(A)
	fmt.Println(ok2, k == any(A{1, 2}), k == any(A{1, 3}))
	_, ok3 := j.(A)
	fmt.Println(ok3)
}
`,
		"false false\ntrue true false\nfalse\n",
	);
});

test("type switch tells a named array from its unnamed type", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type A [2]int

func name(v any) string {
	switch v.(type) {
	case [2]int:
		return "unnamed"
	case A:
		return "A"
	}
	return "other"
}

func main() {
	fmt.Println(name(A{1, 2}), name([2]int{1, 2}), name(1))
}
`,
		"A unnamed other\n",
	);
});

test("a named slice in an any is not the unnamed slice", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S []int

func main() {
	var k any = S{1}
	_, ok := k.([]int)
	_, ok2 := k.(S)
	var j any = []int{1}
	_, ok3 := j.(S)
	fmt.Println(ok, ok2, ok3)
}
`,
		"false true false\n",
	);
});

test("a named array in an any prints, copies and compares like an array", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type A [2]int

func main() {
	var k any = A{1, 2}
	fmt.Printf("%v %T\\n", k, k)
	arr := A{3, 4}
	var j any = arr
	arr[0] = 0
	fmt.Println(j, arr)
	b := k.(A)
	b[0] = 9
	fmt.Println(k, b, k == any(A{1, 2}))
}
`,
		"[1 2] main.A\n[3 4] [0 4]\n[1 2] [9 2] true\n",
	);
});

test("a type switch tells a named slice from its unnamed type in either order", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S []int

func a(v any) string {
	switch v.(type) {
	case []int:
		return "[]int"
	case S:
		return "S"
	}
	return "other"
}

func b(v any) string {
	switch v.(type) {
	case S:
		return "S"
	case []int:
		return "[]int"
	}
	return "other"
}

func main() {
	fmt.Println(a(S{1}), a([]int{1}), b(S{1}), b([]int{1}), a(nil))
}
`,
		"S []int S []int other\n",
	);
});

// The `js` target keeps its documented map-key stringification, so the two
// keys share a slot there.
test("named and unnamed arrays are distinct map[any] keys", async () => {
	await assertWasmProgramOutput(
		`package main

import "fmt"

type A [2]int

func main() {
	m := map[any]int{A{1, 2}: 1}
	fmt.Println(m[[2]int{1, 2}], m[A{1, 2}])
}
`,
		"0 1\n",
	);
});

section("Generic maps and slices of funcs in an interface");

test("a generic map or slice of funcs matches its type in an any", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func mk[V any](v V) any { return map[string]V{} }
func mks[V any](v V) any { return []V{v} }

func main() {
	w := mk(func() {})
	_, ok := w.(map[string]func())
	fmt.Printf("%T %v\\n", w, ok)
	s := mks(func() {})
	_, ok2 := s.([]func())
	fmt.Printf("%T %v\\n", s, ok2)
	n := mk(1)
	_, ok3 := n.(map[string]int)
	fmt.Printf("%T %v\\n", n, ok3)
}
`,
		"map[string]func() true\n[]func() true\nmap[string]int true\n",
	);
});

section("Assertion panic names for arrays and slices of funcs");

test("failed assertions name arrays and slices of funcs", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func try(w any) {
	defer func() { fmt.Println(recover()) }()
	_ = w.(int)
}

func main() {
	try([2]int{})
	try([]func(){})
	var w any = []func(){}
	_, ok := w.([]any)
	fmt.Println(ok)
}
`,
		"interface conversion: interface {} is [2]int, not int\ninterface conversion: interface {} is []func(), not int\nfalse\n",
	);
});

test("a slice of a method interface is not a slice of any", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"errors"
	"fmt"
)

func main() {
	var a any = []error{errors.New("x")}
	_, ok := a.([]any)
	_, ok2 := a.([]error)
	_, ok3 := a.([]fmt.Stringer)
	var b any = []any{1}
	_, ok4 := b.([]any)
	_, ok5 := b.([]error)
	fmt.Println(ok, ok2, ok3, ok4, ok5)
	fmt.Println(a.([]error)[0])
}
`,
		"false true false true false\nx\n",
	);
});

test("[]any and []interface{} are the same dynamic type", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"errors"
	"fmt"
)

func main() {
	var a any = []any{1}
	_, ok1 := a.([]any)
	_, ok2 := a.([]interface{})
	var b any = []interface{}{1}
	_, ok3 := b.([]any)
	_, ok4 := b.([]interface{})
	fmt.Println(ok1, ok2, ok3, ok4)
	var c any = []error{errors.New("x")}
	_, ok5 := c.([]any)
	_, ok6 := c.([]interface{})
	_, ok7 := c.([]error)
	fmt.Println(ok5, ok6, ok7)
}
`,
		"true true true true\nfalse false true\n",
	);
});

test("failed assertions name array lengths and element types", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func try(w any) {
	defer func() { fmt.Println(recover()) }()
	_ = w.(int)
}

func main() {
	try([3]int{})
	try([2]string{})
	try([][2]int{})
	try([]func(int) (string, error){})
}
`,
		"interface conversion: interface {} is [3]int, not int\ninterface conversion: interface {} is [2]string, not int\ninterface conversion: interface {} is [][2]int, not int\ninterface conversion: interface {} is []func(int) (string, error), not int\n",
	);
});

section("Multi-value calls forwarded into interface methods");

const IFACE_FWD = `type T struct{ A int }

func makePair() (T, int) { return T{1}, 1 }

type C interface{ check(v any, n int) bool }

type O struct{}

func (*O) check(v any, n int) bool {
	_, ok := v.(T)
	return ok && n == 1
}

func wrap(b bool) bool { return b }
`;

test("a forwarded call spreads into an interface method call", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

${IFACE_FWD}
func main() {
	var c C = &O{}
	fmt.Println(wrap(c.check(makePair())))
	x := c.check(makePair())
	fmt.Println(x)
}
`,
		"true\ntrue\n",
	);
});

test("a forwarded call into a nil interface method reports the nil dereference", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

${IFACE_FWD}
func main() {
	defer func() { fmt.Println(recover()) }()
	var c C
	fmt.Println(wrap(c.check(makePair())))
}
`,
		"runtime error: invalid memory address or nil pointer dereference\n",
	);
});
