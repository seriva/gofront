// GoFront test suite — codegen regressions from the 1.3.x review

import {
	assert,
	assertAllTargetsOutput,
	assertEqual,
	assertErrorContains,
	assertJsTargetsOutput,
	compile,
	runJs,
	section,
	test,
} from "../helpers.js";

function run(src) {
	const { js, errors } = compile(src);
	assertEqual(errors.map((e) => e.message).join("\n"), "");
	return { js, out: runJs(js) };
}

section("Operator precedence (JS vs Go)");

test("bitwise & binds tighter than == (Go) — parenthesized in JS", () => {
	const { out } = run(`package main
func main() {
	a := 6
	b := 3
	println(a&b == 2)
}`);
	assertEqual(out, "true");
});

test("shift binds tighter than + (Go) — parenthesized in JS", () => {
	const { out } = run(`package main
func main() {
	a := 6
	println(a<<1 + 1)
}`);
	assertEqual(out, "13");
});

test("| and ^ share precedence in Go (left-assoc)", () => {
	const { out } = run(`package main
func main() {
	a, b, c := 6, 3, 2
	println(a | b ^ c)
}`);
	assertEqual(out, "5");
});

test("&^ inside + keeps grouping", () => {
	const { out } = run(`package main
func main() {
	a, b, c := 6, 3, 2
	println(a + (b &^ c))
	println(a &^ (b | c))
}`);
	assertEqual(out, "7\n4");
});

test("right-nested same-precedence ops keep parentheses", () => {
	const { out } = run(`package main
func main() {
	a, b, c := 10, 4, 3
	println(a - (b - c), a - b - c)
}`);
	assertEqual(out, "9 3");
});

test("double negation does not become a decrement", () => {
	const { js, out } = run(`package main
func main() {
	a := 6
	println(- -a, a)
}`);
	assert(!js.includes("--a"), `unexpected decrement in:\n${js}`);
	assertEqual(out, "6 6");
});

section("Range loops");

test("two assign-form range loops in one block compile and run", () => {
	const { out } = run(`package main
func main() {
	s := []int{1, 2, 3}
	var i, v int
	for i, v = range s {
	}
	for i, v = range s {
	}
	println(i, v)
}`);
	assertEqual(out, "2 3");
});

test("modifying the range index in the body does not affect iteration", () => {
	const { out } = run(`package main
func main() {
	c := 0
	for i := range []int{1, 2, 3} {
		i += 10
		c++
	}
	for i := range 3 {
		i++
		c++
	}
	println(c)
}`);
	assertEqual(out, "6");
});

test("range body may shadow the loop variables", () => {
	const { out } = run(`package main
func main() {
	sum := 0
	for i, v := range []int{7, 8} {
		sum += i
		{
			i := v * 2
			sum += i
		}
	}
	println(sum)
}`);
	assertEqual(out, "31");
});

test("range over sized integer types", () => {
	const { out } = run(`package main
func main() {
	var n int32 = 3
	c := 0
	for range n {
		c++
	}
	for i := range n {
		c += int(i)
	}
	println(c)
}`);
	assertEqual(out, "6");
});

section("Typed arrays and sized numbers");

test("append to a nil []float32 keeps a Float32Array", () => {
	const { out } = run(`package main
func main() {
	var fs []float32
	fs = append(fs, 1, 2, 3)
	println(len(fs[1:]))
}`);
	assertEqual(out, "2");
});

test("[]int32 and []rune conversions from string decode code points", () => {
	const { out } = run(`package main
func main() {
	r := []int32("héllo")
	q := []rune("héllo")
	println(len(r), len(q), string(q))
}`);
	assertEqual(out, "5 5 héllo");
});

test("rune and int32 are the same type", () => {
	const { errors } = compile(`package main
func main() {
	var r []rune = []int32{65}
	var x int32 = 'a'
	var y rune = x
	_ = r
	_ = y
}`);
	assertEqual(errors.length, 0);
});

test("[]float64 stays a plain JS array", () => {
	const { js, out } = run(`package main
func main() {
	xs := []float64{1.5, 2.5}
	ys := make([]float64, 2)
	println(len(xs), len(ys))
}`);
	assert(!js.includes("Float64Array"), `unexpected Float64Array:\n${js}`);
	assertEqual(out, "2 2");
});

test("[]float64 is not assignable to Float64Array", () => {
	const { errors } = compile(`package main
func main() {
	var f Float64Array = []float64{1}
	_ = f
}`);
	assertErrorContains(
		errors,
		"cannot use []float64{…} (value of type []float64) as Float64Array value in variable declaration",
	);
});

test("sized integer conversions wrap", () => {
	const { out } = run(`package main
func main() {
	x := 300
	y := -1
	z := 200
	w := 40000
	println(uint8(x), uint32(y), int8(z), int16(w), int32(y))
}`);
	assertEqual(out, "44 4294967295 -56 -25536 -1");
});

section("Structs");

test("struct field named value is a normal field", () => {
	const { out } = run(`package main
type Input struct {
	value string
	n     int
}
func main() {
	i := Input{value: "hi", n: 1}
	println(i.value, i.n)
}`);
	assertEqual(out, "hi 1");
});

test("JS reserved words are valid Go identifiers", () => {
	const { out } = run(`package main
type T struct{ in int }
func delete2(in int) int { return in * 2 }
func main() {
	in := 5
	new := T{in: in}
	println(delete2(new.in))
}`);
	assertEqual(out, "10");
});

section("Multiple assignment evaluation order");

test("targets evaluate their operands before the right-hand sides", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S struct{ f int }

func main() {
	trace := ""
	t := func(s string, v int) int { trace += s; return v }
	s := func(name string, p *S) *S { trace += name; return p }
	pn := func(name string, p *int) *int { trace += name; return p }
	flush := func(label string) {
		fmt.Println(label, trace)
		trace = ""
	}
	two := func() (int, int) { trace += "f"; return 1, 2 }

	var arr [3]int
	arr[t("i", 0)], arr[t("j", 1)] = t("x", 5), t("y", 6)
	flush("o01")

	m := map[int]int{}
	m[t("i", 0)], m[t("j", 1)] = t("x", 5), t("y", 6)
	flush("o02")

	a, b := &S{}, &S{}
	s("a", a).f, s("b", b).f = t("x", 5), t("y", 6)
	flush("o03a")
	p := new(int)
	*pn("p", p), arr[t("i", 0)] = t("x", 5), t("y", 6)
	flush("o03b")

	var k int
	k, arr[t("i", 1)] = t("x", 5), t("y", 6)
	flush("o04")
	_ = k

	xs := []int{1, 2}
	xs[t("a", 0)], xs[t("b", 1)] = xs[t("c", 1)], xs[t("d", 0)]
	flush("o06")
	fmt.Println(xs)

	grid := [][]int{{0, 0}, {0, 0}}
	grid[t("a", 0)][t("b", 1)], grid[t("c", 1)][t("d", 0)], arr[t("e", 2)] = t("x", 1), t("y", 2), t("w", 3)
	flush("o07")

	arr[t("i", 0)], arr[t("j", 1)] = two()
	flush("o08")

	// controls
	arr[t("i", 0)] = t("x", 5)
	flush("o05a")
	arr[t("i", 0)] += t("x", 5)
	flush("o05b")
	fmt.Println(t("a", 1), t("b", 2), []int{t("c", 3), t("d", 4)})
	flush("o09")
	q, r := t("a", 1), t("b", 2)
	_, _ = q, r
	flush("o09b")
	fmt.Println(arr, xs, grid, m, a.f, b.f, *p)
}
`,
		`o01 ijxy
o02 ijxy
o03a abxy
o03b pixy
o04 ixy
o06 abcd
[2 1]
o07 abcdexyw
o08 ijf
o05a ix
o05b ix
1 2 [3 4]
o09 abcd
o09b ab
[10 2 3] [2 1] [[0 1] [2 0]] map[0:5 1:6] 5 6 5
`,
	);
});

test("a multiple assignment without calls emits no operand temporaries", () => {
	const { js } = run(`package main
func main() {
	xs := []int{1, 2}
	i, j := 0, 1
	xs[i], xs[j] = xs[j], xs[i]
	println(xs[0], xs[1])
}`);
	assert(!js.includes("__h"), js);
});

section("Assignment order: blanks, pointer targets, comma-ok");

const ORDER_PRELUDE = `package main

import "fmt"

type S struct{ f int }

func main() {
	trace := ""
	t := func(s string, v int) int { trace += s; return v }
	flush := func(label string) {
		fmt.Println(label, trace)
		trace = ""
	}
	var arr [3]int
`;

test("blank targets still evaluate every right-hand side once", async () => {
	await assertAllTargetsOutput(
		`${ORDER_PRELUDE}
	_, arr[t("i", 0)] = t("x", 5), t("y", 6)
	flush("b1")
	fmt.Println(arr)
	_, _ = t("x", 5), t("y", 6)
	flush("b2")
}
`,
		`b1 ixy
[6 0 0]
b2 xy
`,
	);
});

test("a *p target with a nil check evaluates right-hand sides first", async () => {
	await assertAllTargetsOutput(
		`${ORDER_PRELUDE}
	ps := func(name string, p *S) *S { trace += name; return p }
	p := &S{}
	*ps("p", p), arr[t("i", 0)] = S{5}, t("y", 6)
	flush("d1")
	fmt.Println(p.f, arr[0])
}
`,
		`d1 piy
5 6
`,
	);
});

test("comma-ok assignment evaluates target operands first", async () => {
	await assertAllTargetsOutput(
		`${ORDER_PRELUDE}
	var ok bool
	fv := func() any { trace += "f"; return 3 }
	arr[t("i", 0)], ok = fv().(int)
	flush("c1")
	fmt.Println(arr, ok)
	ks := func(k string) string { trace += "k"; return k }
	m := map[string]int{"k": 4}
	k0 := "k"
	arr[t("i", 1)], ok = m[ks("k")]
	flush("c2")
	fmt.Println(arr, ok)
	v, ok2 := m[k0]
	fmt.Println(v, ok2)
}
`,
		`c1 if
[3 0 0] true
c2 ik
[3 4 0] true
4 true
`,
	);
});

test("for-post and generic *p targets evaluate operands first", async () => {
	await assertAllTargetsOutput(
		`${ORDER_PRELUDE}
	for k := 0; k < 1; k, arr[t("i", 0)] = t("x", 1), t("y", 6) {
	}
	flush("f1")
	fmt.Println(arr)
	x := 0
	nums := make([]int, 3)
	run(&x, 5, 6, nums, &trace)
	flush("g1")
	fmt.Println(x, nums)
}

func run[T any](p *T, v1, v2 T, arr []T, tr *string) {
	pn := func(s string, q *T) *T { *tr += s; return q }
	ti := func(s string, i int) int { *tr += s; return i }
	tv := func(s string, v T) T { *tr += s; return v }
	*pn("p", p), arr[ti("i", 0)] = tv("x", v1), tv("y", v2)
}
`,
		`f1 ixy
[6 0 0]
g1 pixy
5 [6 0 0]
`,
	);
});

test("a *p target mentioning an assigned pointer binds its operand first", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	a, b := 1, 2
	p := &a
	p, *p = &b, 0
	fmt.Println(a, b)

	x, y := 10, 20
	q := &x
	q, *q = &y, 99
	fmt.Println(x, y, *q)

	c, d := 1, 2
	r := &c
	for k := 0; k < 1; r, *r, k = &d, 7, k+1 {
	}
	fmt.Println(c, d)
}
`,
		`0 2
99 20 20
7 2
`,
	);
});

test("a field or element target mentioned by a later dereference binds it first", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type SP struct{ P *int }

func main() {
	sa, sb := 1, 2
	sp := SP{P: &sa}
	sp.P, *sp.P = &sb, 99
	fmt.Println(sa, sb)

	xa, xb := 1, 2
	xs := []*int{&xa}
	xs[0], *xs[0] = &xb, 99
	fmt.Println(xa, xb)

	fa, fb := 1, 2
	fp := SP{P: &fa}
	for k := 0; k < 1; fp.P, *fp.P, k = &fb, 99, k+1 {
	}
	fmt.Println(fa, fb)
}
`,
		`99 2
99 2
99 2
`,
	);
});

test("plain-variable target operands are read after the right-hand call", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	i := 0
	arr := [2]int{}
	fv := func() any { i = 1; return 4 }
	var ok bool
	arr[i], ok = fv().(int)
	fmt.Println(arr, ok)

	i = 0
	arr = [2]int{}
	m := map[string]int{"k": 4}
	ks := func(k string) string { i = 1; return k }
	arr[i], ok = m[ks("k")]
	fmt.Println(arr, ok)

	i = 0
	arr = [2]int{}
	fi := func() int { i = 1; return 1 }
	for k := 0; k < 1; arr[i], k = 9, fi() {
	}
	fmt.Println(arr)
}
`,
		`[0 4] true
[0 4] true
[0 9]
`,
	);
});

test("for-post multi-assignment reads plain-variable operands after the right-hand call", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S struct{ A int }

func main() {
	i := 0
	arr := [2]int{}
	arr2 := [2]int{}
	fv := func() int { i = 1; return 1 }
	ti := func(n int) int { return n }
	k := 0
	for k = 0; k < 1; arr[i], arr2[ti(0)], k = 9, 8, fv() {
	}
	fmt.Println(arr, arr2, k)

	i = 0
	arr = [2]int{}
	p := &S{}
	for k = 0; k < 1; *p, arr[i], k = (S{5}), 9, fv() {
	}
	fmt.Println(p.A, arr, k)
}
`,
		`[0 9] [8 0] 1
5 [0 9] 1
`,
	);
});

test("a comma-ok map lookup stores a struct into *p", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S struct{ f int }

func main() {
	p := &S{1}
	m := map[string]S{"k": {5}}
	var ok bool
	*p, ok = m["k"]
	fmt.Println(*p, ok)
	*p, ok = m["z"]
	fmt.Println(*p, ok)
}
`,
		`{5} true
{0} false
`,
	);
});

test("a comma-ok type assertion stores a struct into *p", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S struct{ f int }

func main() {
	p := &S{1}
	var i any = S{7}
	var ok bool
	*p, ok = i.(S)
	fmt.Println(*p, ok)
}
`,
		"{7} true\n",
	);
});

section("Calls run once (comma-ok define, complex compound)");

test("a non-strict comma-ok define runs the key call once (C1)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func main() {
	n := 0
	k := func() string { n++; return "x" }
	m := map[string]int{"x": 1}
	v, ok := m[k()]
	fmt.Println(v, ok, n)
}
`,
		"1 true 1\n",
	);
});

test("an if initializer comma-ok runs the key call once (C2)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func main() {
	n := 0
	k := func() string { n++; return "x" }
	m := map[string]int{"x": 1}
	if v, ok := m[k()]; ok {
		fmt.Println(v, n)
	}
}
`,
		"1 1\n",
	);
});

test("a call-free comma-ok define keeps the unbound fast path", () => {
	const { js } = compile(`package main
func main() {
	m := map[string]int{"x": 1}
	key := "x"
	v, ok := m[key]
	println(v, ok)
}`);
	assert(!js.includes("__m"), `unexpected temp:\n${js}`);
});

test("complex += runs the right-hand call once (C4)", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	n := 0
	f := func() complex128 { n++; return complex(3, 4) }
	c := complex(1, 2)
	c += f()
	fmt.Println(c, n)
}
`,
		"(4+6i) 1\n",
	);
});

test("complex map and *= compound assignments run each call once", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	n, kn := 0, 0
	f := func() complex128 { n++; return complex(1, 1) }
	k := func() string { kn++; return "a" }
	m := map[string]complex128{"a": complex(1, 2)}
	m[k()] += f()
	c := complex(2, 0)
	c *= f()
	fmt.Println(m["a"], c, n, kn)
}
`,
		"(2+3i) (2+2i) 2 1\n",
	);
});
