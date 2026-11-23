// GoFront test suite — Go value semantics for structs/arrays and T vs *T in interfaces

import {
	assert,
	assertAllTargetsOutput,
	assertContains,
	assertEqual,
	assertJsTargetsOutput,
	assertProgramOutput,
	compile,
	compileHybridProject,
	runJs,
	section,
	test,
} from "../helpers.js";

function run(src) {
	const { js, errors } = compile(src);
	assertEqual(errors.map((e) => e.message).join("\n"), "");
	return { js, out: runJs(js) };
}

const VEC = `package main
type Vec struct {
	X int
	Y int
}
func (v *Vec) Grow() { v.X++ }
func (v Vec) Scaled(k int) Vec {
	v.X *= k
	v.Y *= k
	return v
}
`;

section("Struct value semantics");

test("assignment copies a struct", () => {
	const { out } = run(`${VEC}
func main() {
	t := Vec{X: 1, Y: 2}
	u := t
	u.X = 9
	println(t.X, u.X)
}`);
	assertEqual(out, "1 9");
});

test("mutating the source after `:=` does not affect the copy", () => {
	const { out } = run(`${VEC}
func main() {
	t := Vec{X: 1, Y: 2}
	u := t
	t.X = 9
	arr := [2]int{1, 2}
	b := arr
	arr[0] = 7
	vs := []Vec{{1, 1}}
	c := vs[0]
	vs[0].X = 5
	println(u.X, t.X, b[0], arr[0], c.X, vs[0].X)
}`);
	assertEqual(out, "1 9 1 7 1 5");
});

test("range value is a snapshot when the body writes the collection", () => {
	const { out } = run(`${VEC}
func main() {
	vs := []Vec{{1, 1}, {2, 2}}
	sum := 0
	for i, v := range vs {
		vs[i].X = 100
		sum += v.X
	}
	println(sum, vs[0].X)
}`);
	assertEqual(out, "3 100");
});

test("a returned local captured by a mutating closure is copied", () => {
	const { out } = run(`${VEC}
var bump func()
func mk() Vec {
	v := Vec{X: 1}
	bump = func() { v.X++ }
	return v
}
func main() {
	r := mk()
	bump()
	println(r.X)
}`);
	assertEqual(out, "1");
});

test("value receiver mutations do not leak to the caller", () => {
	const { out } = run(`${VEC}
func main() {
	t := Vec{X: 1, Y: 2}
	w := t.Scaled(3)
	println(t.X, w.X)
}`);
	assertEqual(out, "1 3");
});

test("struct parameters are copies", () => {
	const { out } = run(`${VEC}
func mutate(v Vec) Vec {
	v.X = 100
	return v
}
func ident(v Vec) Vec { return v }
func main() {
	t := Vec{X: 1, Y: 2}
	m := mutate(t)
	id := ident(t)
	id.Y = 50
	println(t.X, m.X, t.Y, id.Y)
}`);
	assertEqual(out, "1 100 2 50");
});

test("nested struct and array fields are deep-copied", () => {
	const { out } = run(`${VEC}
type Box struct {
	Min Vec
	Arr [2]int
}
func main() {
	b := Box{Min: Vec{1, 2}}
	b2 := b
	b2.Min.X = 99
	b2.Arr[0] = 5
	println(b.Min.X, b2.Min.X, b.Arr[0], b2.Arr[0])
}`);
	assertEqual(out, "1 99 0 5");
});

test("slice literals and range values copy struct elements", () => {
	const { out } = run(`${VEC}
func main() {
	t := Vec{X: 1, Y: 2}
	vs := []Vec{t, t}
	vs[0].X = 42
	for _, v := range vs {
		v.Y = -1
	}
	for i := range vs {
		vs[i].Grow()
	}
	println(t.X, vs[0].X, vs[1].X, vs[0].Y)
}`);
	assertEqual(out, "1 43 2 2");
});

test("pointers still share, and *p copies", () => {
	const { out } = run(`${VEC}
func main() {
	t := Vec{X: 1}
	p := &t
	p.Grow()
	q := *p
	q.X = 0
	println(t.X, q.X)
}`);
	assertEqual(out, "2 0");
});

test("read-only struct locals are not copied", () => {
	const { js } = run(`${VEC}
func sum(vs []Vec) int {
	s := 0
	for _, v := range vs {
		s += v.X
	}
	return s
}
func main() { println(sum([]Vec{{1, 2}})) }`);
	assert(!/__arr0\[__i0\]\.__clone\(\)/.test(js), `unexpected copy:\n${js}`);
});

test("a store through a pointer copies array fields (V1)", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T struct{ A [2]int }

func main() {
	var s, s2 T
	ps := &s
	*ps = s2
	ps.A[0] = 9
	fmt.Println(s2, s)
}
`,
		"{[0 0]} {[9 0]}\n",
	);
});

test("a multi-assignment through a pointer copies array fields (V2)", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T struct{ A [2]int }

func main() {
	var s, s2 T
	ps := &s
	x := 0
	*ps, x = s2, 1
	ps.A[0] = 9
	fmt.Println(s2, s, x)
	p := &T{[2]int{5, 6}}
	t2 := T{[2]int{1, 2}}
	*p, x = t2, 9
	t2.A[0] = 99
	fmt.Println(*p, t2)
}
`,
		"{[0 0]} {[9 0]} 1\n{[1 2]} {[99 2]}\n",
	);
});

test("a store through a pointer copies nested struct fields (V3)", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P struct{ M int }
type W struct {
	Q P
	A [2]int
}

func main() {
	var a, b W
	pa := &a
	*pa = b
	pa.Q.M = 3
	pa.A[1] = 4
	fmt.Println(b, a)
	*pa = W{P{1}, [2]int{7, 8}}
	fmt.Println(a)
}
`,
		"{{0} [0 0]} {{3} [0 4]}\n{{1} [7 8]}\n",
	);
});

section("Interfaces holding T vs *T");

test("type switch distinguishes T from *T", () => {
	const { out } = run(`${VEC}
func kind(s any) string {
	switch s.(type) {
	case *Vec:
		return "ptr"
	case Vec:
		return "val"
	}
	return "other"
}
func main() {
	t := Vec{}
	println(kind(t), kind(&t), kind(Vec{}), kind(&Vec{}))
}`);
	assertEqual(out, "val ptr val ptr");
});

test("interface holds a copy of a struct value", () => {
	const { out } = run(`${VEC}
type Shape interface{ Area() int }
func (v Vec) Area() int { return v.X * v.Y }
func main() {
	t := Vec{2, 2}
	var s Shape = t
	t.X = 1000
	println(s.Area())
}`);
	assertEqual(out, "4");
});

test("type assertion to *T and T", () => {
	const { out } = run(`${VEC}
func main() {
	t := Vec{X: 3}
	var a any = &t
	var b any = t
	_, okA := a.(Vec)
	p, okP := a.(*Vec)
	_, okB := b.(*Vec)
	println(okA, okP, p.X, okB)
}`);
	assertEqual(out, "false true 3 false");
});

section("Full slice expressions alias (Task 0.19a)");

test("b[:] and a[:] share the backing store in a js package", () => {
	const { js, out } = run(`package main

func main() {
	b := []int{1, 2, 3}
	s := b[:]
	s[0] = 9
	a := [2]string{"x", "y"}
	t := a[0:]
	t[1] = "z"
	println(b[0], a[1])
}`);
	assertEqual(out, "9 z");
	assert(!js.includes(".slice()"), "full slice must not copy");
});

section("Tuple assignment order");

test("tuple targets that name struct or array storage are not copied", async () => {
	const src = `package main

import "fmt"

type S struct{ A, B int }

func main() {
	var s, t S = S{1, 2}, S{3, 4}
	s, s.A = t, 9
	fmt.Println(s, t)
	other := [2]int{7, 8}
	var arr [2]int
	arr, arr[0] = other, 5
	fmt.Println(arr)
}
`;
	await assertProgramOutput(src, "{9 4} {3 4}\n[5 8]\n");
});

test("index operands are evaluated before the assignment", async () => {
	const src = `package main

import "fmt"

type S struct{ A, B int }

func main() {
	k := 0
	xs := []int{0, 2}
	k, xs[k] = 1, 5
	fmt.Println(k, xs)
	i := 0
	ys := []int{1, 2, 3}
	i, ys[i] = ys[i], i+10
	fmt.Println(i, ys)
	ys[0], ys[1] = ys[1], ys[0]
	fmt.Println(ys)
	m := map[int]int{}
	j := 1
	j, m[j] = 4, 7
	fmt.Println(j, m)
	p := &S{1, 2}
	q := &S{3, 4}
	p, p.A = q, 9
	fmt.Println(*p, *q)
}
`;
	await assertProgramOutput(
		src,
		"1 [5 2]\n1 [10 2 3]\n[2 10 3]\n4 map[1:7]\n{3 4} {3 4}\n",
	);
});

test("tuple assignment evaluates the index inside a field target first", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type P struct{ A int }

func main() {
	ps := []P{{0}, {0}}
	n := 0
	n, ps[n].A = 1, 50
	fmt.Println(ps, n)
	var arr [2]P
	k := 0
	k, arr[k].A = 1, 7
	fmt.Println(arr, k)
}
`,
		"[{50} {0}] 1\n[{7} {0}] 1\n",
	);
});

// Runs `src` as a `js` package and as the JS half of a `both` package.
function runJsAndBoth(src) {
	const outs = [];
	for (const target of ["js", "both"]) {
		const { js, errors } = compile(src, { target });
		assertEqual(errors.map((e) => e.message).join("\n"), "");
		outs.push(runJs(js));
	}
	assertEqual(outs[0], outs[1], "js and both disagree");
	return outs[0];
}

section("Nil slices stay nil");

test("nil slice elements and struct fields print as []", () => {
	assertEqual(
		runJsAndBoth(`package main
import "fmt"
type A struct{ S []int }
func main() {
	fmt.Println(make([][]int, 2))
	fmt.Println(A{})
	fmt.Println(fmt.Sprintf("%+v", []A{{}}))
}`),
		"[[] []]\n{[]}\n[{S:[]}]",
	);
});

test("append with nothing to add keeps a nil slice nil", () => {
	assertEqual(
		runJsAndBoth(`package main
import "fmt"
func main() {
	var ap []int
	ap = append(ap, ap...)
	fmt.Println(ap == nil)
	fmt.Println(append([]int(nil), []int{}...) == nil, append([]byte(nil), ""...) == nil)
	b := append([]byte(nil), "hi"...)
	fmt.Println(len(b), b[0])
}`),
		"true\ntrue true\n2 104",
	);
});

// ── Struct values copied out of maps, range keys and interfaces ──

section("Copies out of maps, range keys and interfaces");

test("a range key assigned to an existing variable is a copy", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type K struct {
	S string
	N int
}

func main() {
	m := map[K]int{{"a", 1}: 2}
	var k2 K
	for k2 = range m {
	}
	k2.N = 99
	for k := range m {
		k.N = 5
	}
	fmt.Println(m, k2)
}
`,
		"map[{a 1}:2] {a 99}\n",
	);
});

test("range key and value of struct type are copies", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type K struct {
	S string
	N int
}

func main() {
	m := map[K]K{{"a", 1}: {"b", 2}}
	var k2, v2 K
	for k2, v2 = range m {
	}
	k2.N = 98
	v2.N = 97
	for k, v := range m {
		k.N = 5
		v.N = 6
	}
	fmt.Println(m, k2, v2)
}
`,
		"map[{a 1}:{b 2}] {a 98} {b 97}\n",
	);
});

test("comma-ok map reads of struct and array values are copies", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P struct{ X, Y int }

func main() {
	m := map[string]P{"a": {1, 1}}
	pt, _ := m["a"]
	pt.X = 100
	fmt.Println(m["a"])
	q, ok := m["zz"]
	q.X = 5
	var r P
	var ok3 bool
	r, ok3 = m["a"]
	r.Y = 7
	arrm := map[int][2]int{1: {1, 2}}
	a, _ := arrm[1]
	a[0] = 9
	if w, ok := m["a"]; ok {
		w.X = 3
	}
	fmt.Println(m, ok, q, r, ok3, arrm, a)
}
`,
		"{1 1}\nmap[a:{1 1}] false {5 0} {1 7} true map[1:[1 2]] [9 2]\n",
	);
});

test("comma-ok type assertions to a struct are copies", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type K struct {
	S string
	N int
}

func main() {
	var x any = K{"x", 1}
	y, ok := x.(K)
	y.N = 50
	var z K
	z, ok = x.(K)
	z.N = 51
	fmt.Println(x, y, z, ok)
}
`,
		"{x 1} {x 50} {x 51} true\n",
	);
});

test("fmt prints the contents a slice holds after later operands run", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	w := make([]byte, 3)
	p := []byte("abc")
	fmt.Println(w, copy(w, p))
	m := map[string]int{}
	set := func() int { m["k"] = 1; return 2 }
	fmt.Println(m, set())
}
`,
		"[97 98 99] 3\nmap[k:1] 2\n",
	);
});

section("Slice element copies");

test("append and copy clone struct elements", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P struct{ N, M int }

func main() {
	a := []P{{1, 1}}
	b := append([]P(nil), a...)
	b[0].N = 50
	fmt.Println(a)
	c := make([]P, 1)
	copy(c, a)
	c[0].N = 7
	fmt.Println(a, c)
	d := append(a, a...)
	d[1].N = 9
	fmt.Println(a, d)
}
`,
		"[{1 1}]\n[{1 1}] [{7 1}]\n[{1 1}] [{1 1} {9 1}]\n",
	);
});

for (const target of ["js", "both", "wasm"]) {
	test(`a pointer into another package's slice sees a later element store (${target})`, async () => {
		const { lines } = await compileHybridProject({
			"p/p.go": `//gofront:target ${target}
package p

type S struct{ A int }

func First(xs []S) *S { return &xs[0] }
`,
			"main.go": `//gofront:target ${target}
package main

import (
	"fmt"
	"./p"
)

func main() {
	ys := []p.S{{1}, {2}}
	q := p.First(ys)
	ys[0] = p.S{9}
	fmt.Println(q.A)
}
`,
		});
		assertEqual(lines.join("\n"), "9");
	});
}

section("Anonymous struct values");

test("an anonymous struct copy clones its array field", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	st := struct{ A [2]int }{}
	cp := st
	cp.A[1] = 6
	fmt.Println(st.A[1], cp.A[1])
}
`,
		"0 6\n",
	);
});

test("an anonymous struct copy clones its struct field", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P struct{ N int }

func main() {
	st := struct{ In P }{}
	cp := st
	cp.In.N = 5
	fmt.Println(st.In.N, cp.In.N)
}
`,
		"0 5\n",
	);
});

test("an anonymous struct copy clones nested aggregates and shares pointers and slices", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P struct{ N int }

func main() {
	a := struct {
		In  struct{ A [2]int }
		Ps  [2]P
		Ptr *P
		S   []int
	}{Ptr: &P{1}, S: []int{1, 2}}
	b := a
	b.In.A[0] = 7
	b.Ps[0].N = 9
	b.Ps[1].N = 10
	b.Ptr.N = 8
	b.S[0] = 7
	fmt.Println(a.In.A[0], b.In.A[0], a.Ps[0].N, b.Ps[0].N, a.Ps[1].N, b.Ps[1].N)
	fmt.Println(a.Ptr.N, a.S[0])
}
`,
		"0 7 0 9 0 10\n8 7\n",
	);
});

test("anonymous struct params, returns, array elements and array copies are independent", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func param(t struct{ A [2]int }) struct{ A [2]int } {
	t.A[0] = 1
	return t
}

func main() {
	var s struct{ A [2]int }
	r := param(s)
	fmt.Println(s.A[0], r.A[0])
	arr := [2]struct{ A [2]int }{}
	e := arr[0]
	e.A[0] = 3
	c := arr
	c[1].A[0] = 4
	fmt.Println(arr[0].A[0], e.A[0], arr[1].A[0], c[1].A[0])
	g := func() struct{ A [2]int } { return s }
	h := g()
	h.A[1] = 5
	fmt.Println(s.A[1], h.A[1])
}
`,
		"0 1\n0 3 0 4\n0 5\n",
	);
});

test("a named struct with an anonymous struct field copies it", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type H struct{ In struct{ A [2]int } }

func main() {
	h := H{}
	g := h
	g.In.A[1] = 5
	fmt.Println(h.In.A[1], g.In.A[1])
}
`,
		"0 5\n",
	);
});

test("an anonymous struct compares by value after a copy is modified", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	st := struct{ A [2]int }{}
	cp := st
	cp.A[0] = 9
	fmt.Println(cp == st)
	cp.A[0] = 0
	fmt.Println(cp == st)
}
`,
		"false\ntrue\n",
	);
});

test("an anonymous struct boxed into any is a copy", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	st := struct{ A [2]int }{[2]int{1, 2}}
	var a any = st
	st.A[0] = 7
	st.A[1] = 8
	fmt.Println(a.(struct{ A [2]int }).A)
	b := a.(struct{ A [2]int })
	b.A[0] = 5
	fmt.Println(a.(struct{ A [2]int }).A, b.A)
}
`,
		"[1 2]\n[1 2] [5 2]\n",
	);
});

test("anonymous struct slice literal elements, append and range values are copies", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	e := struct{ A [2]int }{}
	sl := []struct{ A [2]int }{e}
	e.A[0] = 9
	sl = append(sl, e)
	e.A[1] = 5
	for _, v := range sl {
		v.A[0] = 1
	}
	fmt.Println(sl[0].A, sl[1].A, e.A)
	for _, v := range sl {
		fmt.Println(v.A)
	}
}
`,
		"[0 0] [9 0] [9 5]\n[0 0]\n[9 0]\n",
	);
});

test("dereferencing and returning an anonymous struct copies it", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	s := struct{ A [2]int }{}
	p := &s
	cp := *p
	cp.A[0] = 4
	f := func() struct{ A [2]int } { return s }
	r := f()
	r.A[1] = 5
	fmt.Println(s.A, cp.A, r.A)
}
`,
		"[0 0] [4 0] [0 5]\n",
	);
});

test("a scalar-only anonymous struct copy still uses __sclone", () => {
	const { js, out } = run(`package main

import "fmt"

func main() {
	st := struct{ N int }{}
	cp := st
	cp.N = 5
	fmt.Println(st.N, cp.N)
}
`);
	assertContains(js, "__sclone(");
	assertEqual(out, "0 5");
});

test("a defined array with methods compares with an interface structurally", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

type MyArr [2]int

func (MyArr) M() {}

type I interface{ M() }

func main() {
	var ia I = MyArr{1, 2}
	ma := MyArr{1, 2}
	fmt.Println(ia == ma, ma == ia, ia != ma, ma != ia)
	switch ma {
	case ia:
		fmt.Println("iface")
	default:
		fmt.Println("none")
	}
	var ia1 I = MyArr{3, 4}
	switch ma {
	case ia1:
		fmt.Println("ia1")
	case MyArr{1, 2}:
		fmt.Println("concrete")
	}
}
`,
		"true true false false\niface\nconcrete\n",
	);
});

test("a defined struct with methods and a plain array keep matching Go against interfaces", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

type S struct{ A, B int }

func (S) M() {}

type I interface{ M() }

func main() {
	var i I = S{1, 2}
	s := S{1, 2}
	fmt.Println(i == s, s == i, i != s, s != i)
	switch s {
	case i:
		fmt.Println("iface")
	}
	var j I = S{3, 4}
	switch s {
	case j:
		fmt.Println("j")
	case S{1, 2}:
		fmt.Println("concrete")
	}
	var a any = [2]int{1, 2}
	p := [2]int{1, 2}
	fmt.Println(a == p, p == a)
	switch p {
	case a:
		fmt.Println("any")
	}
}
`,
		"true true false false\niface\nconcrete\ntrue true\nany\n",
	);
});

test("a generic copy of an anonymous struct clones its array field", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func dup[T any](v T) (T, T) { return v, v }

func main() {
	st := struct{ A [2]int }{}
	x, y := dup(st)
	x.A[0] = 1
	fmt.Println(st.A[0], x.A[0], y.A[0])
}
`,
		"0 1 0\n",
	);
});

test("a generic identity of an anonymous struct returns an independent copy", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func id[T any](v T) T { return v }

func main() {
	st := struct{ A [2]int }{}
	a := id(st)
	a.A[0] = 1
	fmt.Println(st.A[0], a.A[0])
}
`,
		"0 1\n",
	);
});

test("a generic copy of an anonymous struct keeps sharing the pointee", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P struct{ N int }

func dup[T any](v T) (T, T) { return v, v }

func main() {
	st := struct {
		Ptr *P
		A   [2]int
	}{&P{1}, [2]int{}}
	x, y := dup(st)
	x.Ptr.N = 5
	x.A[0] = 2
	fmt.Println(st.Ptr.N, y.Ptr.N, st.A[0], x.A[0], y.A[0])
}
`,
		"5 5 0 2 0\n",
	);
});

test("an elided anonymous struct literal in a slice fills zero values", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	sl := []struct{ A [2]int }{{}, {A: [2]int{1, 2}}}
	fmt.Println(sl[0].A, sl[1].A, len(sl))
}
`,
		"[0 0] [1 2] 2\n",
	);
});

test("elided anonymous struct literals in maps and arrays fill zero values", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	m := map[string]struct{ N int }{"k": {}}
	arr := [2]struct{ S string }{{}, {"x"}}
	fmt.Println(m["k"].N, len(arr), arr[0].S == "", arr[1].S)
}
`,
		"0 2 true x\n",
	);
});

test("a value read from a map of anonymous structs is a copy", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	m := map[string]struct{ A [2]int }{"k": {}}
	v := m["k"]
	v.A[0] = 1
	fmt.Println(m["k"].A[0], v.A[0])
}
`,
		"0 1\n",
	);
});

test("an elided anonymous struct pointer literal builds a struct", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	a := []*struct{ N int }{{}}
	b := []*struct{ N int }{{N: 3}}
	fmt.Println(a[0].N, b[0].N)
	a[0].N = 2
	fmt.Println(a[0].N, b[0].N)
}
`,
		"0 3\n2 3\n",
	);
});

test("elided named struct literals keep working", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P struct{ N int }

func main() {
	a := []P{{}}
	m := map[string]*P{"k": {}}
	fmt.Println(a[0].N, m["k"].N)
}
`,
		"0 0\n",
	);
});

test("generic copies of anonymous structs share map fields", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func dup[T any](v T) (T, T) { return v, v }

func main() {
	st := struct{ M map[string]int }{M: map[string]int{"a": 1}}
	x, y := dup(st)
	x.M["a"] = 9
	fmt.Println(st.M["a"], x.M["a"], y.M["a"])
	arr := [2]struct{ M map[string]int }{{M: map[string]int{"a": 1}}}
	p, _ := dup(arr)
	p[0].M["a"] = 5
	fmt.Println(arr[0].M["a"], p[0].M["a"])
}
`,
		"9 9 9\n5 5\n",
	);
});

test("generic copies of anonymous structs copy byte array fields", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func dup[T any](v T) (T, T) { return v, v }

func main() {
	st := struct{ B [4]byte }{[4]byte{1, 2, 3, 4}}
	x, y := dup(st)
	x.B[0] = 7
	fmt.Println(len(x.B), x.B[0], x.B, st.B, y.B)
	s := x.B[1:3]
	fmt.Println(s, len(s))
}
`,
		"4 7 [7 2 3 4] [1 2 3 4] [1 2 3 4]\n[2 3] 2\n",
	);
});

test("conversion to an embedding anonymous struct drops the source type", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P struct{ N int }
type S struct{ P }

func (S) M() {}

func main() {
	s := S{P{7}}
	u := struct{ P }(s)
	var a any = u
	_, isS := a.(S)
	_, isM := a.(interface{ M() })
	u.P.N = 9
	fmt.Println(isS, isM, u.N, s.N)
}
`,
		"false false 9 7\n",
	);
});

test("conversion to an anonymous struct type copies and parses", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S struct{ A [2]int }

func main() {
	s := S{[2]int{1, 2}}
	u := struct{ A [2]int }(s)
	s.A[0] = 9
	var a any = u
	fmt.Printf("%T %v\\n", a, u)
	v := struct{ A [2]int }{[2]int{3, 4}}
	fmt.Println(v, s)
}
`,
		"struct { A [2]int } {[1 2]}\n{[3 4]} {[9 2]}\n",
	);
});

test("alias of an anonymous struct has fields and zero value", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T = struct{ A [2]int }
type S = struct{ A [2]int }
type U = T

func main() {
	var s T
	s.A[0] = 1
	fmt.Println(s.A[0])
	var z S
	fmt.Println(z.A[0])
	var u U
	u.A[1] = 5
	cp := u
	cp.A[0] = 2
	fmt.Println(u.A, cp.A)
}
`,
		"1\n0\n[0 5] [2 5]\n",
	);
});

test("anonymous struct copies are field-wise for embedded, defined-array and type-parameter arrays", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P struct{ A [2]int }
type Vec [2]int

func f(s struct{ V Vec }) { s.V[0] = 9 }

func g[T any](a T) {
	st := struct{ X [2]T }{}
	st.X[0] = a
	cp := st
	cp.X[0] = a
	fmt.Println(len(cp.X))
}

func main() {
	st := struct {
		P
		B [2]int
	}{}
	cp := st
	cp.P.A[0] = 7
	fmt.Println(st.P.A[0], cp.P.A[0])

	x := struct{ V Vec }{}
	f(x)
	fmt.Println(x.V[0])

	var a any = struct{ A [2]int }{}
	switch v := a.(type) {
	case struct{ A [2]int }:
		v.A[0] = 5
		fmt.Println(v.A[0], a.(struct{ A [2]int }).A[0])
	}

	s := struct{ A [2]int }{}
	seq := func(yield func(struct{ A [2]int }) bool) { yield(s) }
	for v := range seq {
		v.A[0] = 4
	}
	fmt.Println(s.A[0])
	g(1)
}
`,
		"0 7\n0\n5 0\n0\n2\n",
	);
});

test("generic copies keep maps shared and copy arrays", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func dup[T any](v T) (T, T) { return v, v }

func main() {
	m := map[string]int{"a": 1}
	x, y := dup(m)
	x["a"] = 9
	fmt.Println(x["a"], y["a"], m["a"])
	b, _ := dup([4]byte{1, 2, 3, 4})
	fmt.Println(len(b))
	s := []int{1}
	c, d := dup([2][]int{s, s})
	c[0][0] = 7
	fmt.Println(d[0][0], s[0])
}
`,
		"9 9 9\n4\n7 7\n",
	);
});

test("a scalar-only anonymous struct copy still uses __sclone", () => {
	const { js } = run(`package main

import "fmt"

func main() {
	s := struct{ N int }{1}
	cp := s
	cp.N = 2
	fmt.Println(s.N, cp.N)
}
`);
	assertContains(js, "__sclone(");
});

test("assertions and type switches on an anonymous struct alias check the type", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T = struct{ A [2]int }

func main() {
	var a any = 42
	_, ok := a.(T)
	fmt.Println(ok)
	switch a.(type) {
	case T:
		fmt.Println("T")
	default:
		fmt.Println("other")
	}
	func() {
		defer func() { fmt.Println(recover() != nil) }()
		_ = a.(T)
	}()
	var b any = T{}
	_, ok = b.(T)
	fmt.Println(ok)
}
`,
		"false\nother\ntrue\ntrue\n",
	);
});

test("a type-switch binding of an anonymous struct alias is a copy", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T = struct{ A [2]int }

func main() {
	var a any = T{}
	switch v := a.(type) {
	case T:
		v.A[0] = 5
		fmt.Println(v.A[0], a.(T).A[0])
	}
}
`,
		"5 0\n",
	);
});

section("Whole-value stores in closures");

const closureCase = (name, body, want) =>
	test(name, async () => {
		await assertAllTargetsOutput(
			`package main

import "fmt"

type S struct{ N int }

func main() {
${body}
}
`,
			want,
		);
	});

closureCase(
	"a struct reassigned in a closure stays visible through its pointer",
	`	s := S{1}
	ps := &s
	f := func() { s = S{2} }
	f()
	fmt.Println(*ps, ps == &s)`,
	"{2} true\n",
);

closureCase(
	"a nested-block shadow in a closure does not detach the outer pointer",
	`	s := S{1}
	ps := &s
	f := func() {
		if true {
			s := S{9}
			_ = s
		}
		s = S{2}
	}
	f()
	fmt.Println(*ps, ps == &s)`,
	"{2} true\n",
);

closureCase(
	"a nested-block array shadow in a closure keeps the outer slice view",
	`	arr := [2]int{1, 2}
	sl := arr[:]
	f := func() {
		if true {
			arr := [2]int{9, 9}
			_ = arr
		}
		arr = [2]int{3, 4}
	}
	f()
	fmt.Println(sl)`,
	"[3 4]\n",
);

closureCase(
	"an array reassigned in a closure keeps its identity",
	`	arr := [2]int{1, 2}
	pa := &arr
	f := func() { arr = [2]int{3, 4} }
	f()
	fmt.Println(*pa, pa == &arr)`,
	"[3 4] true\n",
);

closureCase(
	"a multi-assignment in a closure stores through the pointer",
	`	s := S{1}
	ps := &s
	j := 0
	f := func() { s, j = S{2}, 1 }
	f()
	fmt.Println(*ps, j)`,
	"{2} 1\n",
);

closureCase(
	"copying another struct in a closure keeps the pointer identity",
	`	s := S{1}
	ps := &s
	t := S{5}
	f := func() { s = t; s.N = 5 }
	f()
	fmt.Println(*ps, ps == &s)`,
	"{5} true\n",
);

closureCase(
	"assigning a dereferenced pointer in a closure keeps the pointer identity",
	`	s := S{1}
	ps := &s
	f := func() { s = *ps; s.N = 5 }
	f()
	fmt.Println(*ps, ps == &s)`,
	"{5} true\n",
);

closureCase(
	"a pointer returned from another closure sees the store",
	`	s := S{1}
	get := func() *S { return &s }
	set := func() { s = S{2} }
	p := get()
	set()
	fmt.Println(p == &s, *p == s)`,
	"true true\n",
);

closureCase(
	"the address is taken after the closure is created",
	`	s := S{1}
	f := func() { s = S{2} }
	ps := &s
	f()
	fmt.Println(*ps)`,
	"{2}\n",
);

closureCase(
	"a closure in a range body stores through the pointer",
	`	s := S{1}
	ps := &s
	for i := 3; i < 4; i++ {
		func() { s = S{i} }()
	}
	fmt.Println(*ps)`,
	"{3}\n",
);

closureCase(
	"a closure that declares its own struct does not touch the outer one",
	`	s := S{1}
	ps := &s
	f := func() {
		s := S{9}
		s = S{8}
		fmt.Println(s)
	}
	f()
	fmt.Println(*ps)`,
	"{8}\n{1}\n",
);

test("an interface compares equal to a struct or array value on the JS targets (O8.1, O8.2)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

type I interface{}
type P struct{ X int }
type Q struct{ X int }

func main() {
	var i I = P{1}
	fmt.Println(i == P{1}, P{1} == i, i != P{1}, i != P{2})
	var a any = [2]int{1, 2}
	fmt.Println(a == [2]int{1, 2}, a != [2]int{1, 3})
	var b any = P{1}
	var a1 any = &P{1}
	var a2 any = Q{1}
	fmt.Println(b == P{1}, P{1} == b, P{1} == a1, P{1} == a2)
	p := &P{1}
	var ip any = p
	fmt.Println(ip == p, p == ip)
	switch b {
	case P{2}:
		fmt.Println("two")
	case P{1}:
		fmt.Println("one")
	}
}
`,
		"true true false true\ntrue true\ntrue true false false\ntrue true\none\n",
	);
});

test("a struct switch tag compares against interface cases by dynamic type on the JS targets", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

type P struct{ X int }
type Q struct{ X int }

func main() {
	var a1 any = &P{1}
	var a2 any = Q{1}
	var a3 any = P{1}
	switch (P{1}) {
	case a1:
		fmt.Println("a1")
	case a2:
		fmt.Println("a2")
	default:
		fmt.Println("none")
	}
	switch (P{1}) {
	case a3:
		fmt.Println("a3")
	default:
		fmt.Println("none")
	}
}
`,
		"none\na3\n",
	);
});

section("Whole-value stores");

// Each body runs in `main`; `S` is `struct{ N int }`.
const storeCase = (name, decls, body, want, assertFn = assertJsTargetsOutput) =>
	test(name, async () => {
		await assertFn(
			`package main

import "fmt"

type S struct{ N int }

${decls}

func main() {
${body}
}
`,
			want,
		);
	});

storeCase(
	"a comma-ok map read into an address-taken struct updates it in place",
	"",
	`	s := S{1}
	ps := &s
	m := map[string]S{"k": {5}}
	var ok bool
	s, ok = m["k"]
	fmt.Println(*ps, ps == &s, ok)`,
	"{5} true true\n",
);

storeCase(
	"a comma-ok type assertion into an address-taken struct updates it in place",
	"",
	`	s := S{1}
	ps := &s
	var i any = S{6}
	var ok bool
	s, ok = i.(S)
	fmt.Println(*ps, ps == &s, ok)`,
	"{6} true true\n",
);

storeCase(
	"a comma-ok map read into a sliced array updates the slice view",
	"",
	`	var arr [2]int
	sl := arr[:]
	m := map[string][2]int{"k": {7, 8}}
	var ok bool
	arr, ok = m["k"]
	fmt.Println(sl, ok)`,
	"[7 8] true\n",
);

storeCase(
	"a comma-ok type assertion into a sliced array updates the slice view",
	"",
	`	var arr [2]int
	sl := arr[:]
	var i any = [2]int{3, 4}
	var ok bool
	arr, ok = i.([2]int)
	fmt.Println(sl, ok)`,
	"[3 4] true\n",
);

storeCase(
	"a missed comma-ok map read zeroes an address-taken struct in place",
	"",
	`	s := S{1}
	ps := &s
	m := map[string]S{}
	var ok bool
	s, ok = m["k"]
	fmt.Println(*ps, ps == &s, ok)`,
	"{0} true false\n",
);

storeCase(
	"a comma-ok result into an address-taken bool updates it in place",
	"",
	`	var ok bool
	pok := &ok
	m := map[string]int{"k": 1}
	_, ok = m["k"]
	fmt.Println(*pok)`,
	"true\n",
);

storeCase(
	"a comma-ok map read through *p stores into the pointee",
	"",
	`	s := S{1}
	p := &s
	m := map[string]S{"k": {5}}
	var ok bool
	*p, ok = m["k"]
	fmt.Println(s, ok)`,
	"{5} true\n",
);

storeCase(
	"a comma-ok type assertion through *p stores into the pointee",
	"",
	`	s := S{1}
	p := &s
	var i any = S{6}
	var ok bool
	*p, ok = i.(S)
	fmt.Println(s, ok)`,
	"{6} true\n",
);

const GENERIC_STORE = `func fromMap[T any](p *T, m map[string]T) bool {
	var ok bool
	*p, ok = m["k"]
	return ok
}

func fromAssert[T any](p *T, a any) bool {
	var ok bool
	*p, ok = a.(T)
	return ok
}`;

storeCase(
	"a generic *T comma-ok map read and assertion store for struct, array and int",
	GENERIC_STORE,
	`	var s S
	var arr [2]int
	var n int
	fmt.Println(fromMap(&s, map[string]S{"k": {5}}), s)
	fmt.Println(fromMap(&arr, map[string][2]int{"k": {5, 6}}), arr)
	fmt.Println(fromMap(&n, map[string]int{"k": 5}), n)
	fmt.Println(fromAssert(&s, S{7}), s)
	fmt.Println(fromAssert(&arr, [2]int{7, 8}), arr)
	fmt.Println(fromAssert(&n, 7), n)
	fmt.Println(fromAssert(&n, "x"), n)`,
	"true {5}\ntrue [5 6]\ntrue 5\ntrue {7}\ntrue [7 8]\ntrue 7\nfalse 0\n",
);

storeCase(
	"a generic *T comma-ok map read stores a copy, not the map's array",
	GENERIC_STORE,
	`	var arr [2]int
	m := map[string][2]int{"k": {5, 6}}
	fromMap(&arr, m)
	arr[0] = 9
	fmt.Println(m["k"], arr)`,
	"[5 6] [9 6]\n",
);
