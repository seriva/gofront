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

test("a struct reassigned to a variable a closure reads keeps its own copy (V4.1)", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type V struct{ M, K int }

func main() {
	v := V{9, 5}
	w := v
	w = v
	v.K = 7
	fmt.Println(w)
	func() { _ = w.M }()
}
`,
		"{9 5}\n",
	);
});

test("a struct stored into a variable a closure mutates is a copy (V4.3)", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P struct{ M int }
type V struct {
	P
	K int
}

func main() {
	v := V{P{-4}, 7}
	w := v
	f := func() { v.M = 5 }
	v = w
	f()
	fmt.Println(w, v)
}
`,
		"{{-4} 7} {{5} 7}\n",
	);
});

test("a captured struct whose address is taken is stored in place and copies its source", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S struct{ N int }

func main() {
	w := S{1}
	src := S{2}
	pw := &w
	f := func() { w.N += 10 }
	w = src
	f()
	fmt.Println(*pw, pw == &w, src)
}
`,
		"{12} true {2}\n",
	);
});

test("struct fields of a composite literal are copies (V4.2)", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P2 struct{ A [2]int }
type W struct{ Q P2 }

func main() {
	p := P2{[2]int{1, 2}}
	var a W
	pa := &a
	*pa = W{Q: p}
	pa.Q.A[0] = 9
	fmt.Println(p, a)
	b := W{Q: p}
	b.Q.A[1] = 8
	fmt.Println(p, b)
}
`,
		"{[1 2]} {{[9 2]}}\n{[1 2]} {{[1 8]}}\n",
	);
});

section("Pointer identity");

test("a pointer-receiver call on (*p) of a named number changes the pointee (V5.1)", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Num int

func (n *Num) Inc() { *n++ }

func main() {
	var x Num
	p := &x
	(*p).Inc()
	(*p).Inc()
	fmt.Println(x)
}
`,
		"2\n",
	);
});

test("a pointer-receiver call on (*p) of a named slice or string changes the pointee", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type L []int
type Str string

func (l *L) Add(n int) { *l = append(*l, n) }
func (s *Str) Bang()   { *s += "!" }

func main() {
	var l L
	pl := &l
	(*pl).Add(1)
	(*pl).Add(2)
	var s Str = "hi"
	ps := &s
	(*ps).Bang()
	fmt.Println(l, s)
}
`,
		"[1 2] hi!\n",
	);
});

test("&(*p) is p itself for scalars, structs and arrays", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Num int
type S struct{ N int }
type A [2]int

func main() {
	var x Num
	p := &x
	q := &(*p)
	*q = 99
	fmt.Println(x, q == p)

	var s S
	ps := &s
	qs := &(*ps)
	qs.N = 7
	fmt.Println(s, qs == ps)

	var a A
	pa := &a
	qa := &(*pa)
	qa[1] = 5
	fmt.Println(a, qa == pa)

	var i int
	pi := &i
	qi := &((*pi))
	*qi = 3
	fmt.Println(i, qi == pi)
}
`,
		"99 true\n{7} true\n[0 5] true\n3 true\n",
	);
});

test("&(*p) through a pointer to a pointer is the inner pointer", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Num int

func (n *Num) Inc() { *n++ }

func main() {
	var x Num
	p := &x
	pp := &p
	(**pp).Inc()
	q := &(**pp)
	*q += 10
	fmt.Println(x, q == p)
}
`,
		"11 true\n",
	);
});

test("struct and array pointer-receiver calls on (*p) still change the pointee", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S struct{ N int }
type A [2]int

func (s *S) Inc() { s.N++ }
func (a *A) Inc() { a[0]++ }

func main() {
	var s S
	ps := &s
	(*ps).Inc()
	var a A
	pa := &a
	(*pa).Inc()
	fmt.Println(s, a)
}
`,
		"{1} [1 0]\n",
	);
});

test("(*get()).Inc() calls get once", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Num int

func (n *Num) Inc() { *n++ }

func main() {
	var x Num
	calls := 0
	get := func() *Num {
		calls++
		return &x
	}
	(*get()).Inc()
	fmt.Println(x, calls)
}
`,
		"1 1\n",
	);
});

test("&(*p) and (*p).M() on a nil pointer panic", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Num int
type S struct{ N int }

func (n *Num) Inc() { *n++ }
func (s *S) Inc()   { s.N++ }

func try(f func()) {
	defer func() { fmt.Println(recover()) }()
	f()
}

func main() {
	var pn *Num
	var ps *S
	try(func() { (*pn).Inc() })
	try(func() { _ = &(*pn) })
	try(func() { (*ps).Inc() })
	try(func() { _ = &(*ps) })
}
`,
		"runtime error: invalid memory address or nil pointer dereference\nruntime error: invalid memory address or nil pointer dereference\nruntime error: invalid memory address or nil pointer dereference\nruntime error: invalid memory address or nil pointer dereference\n",
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
const storeCase = (
	name,
	decls,
	body,
	want,
	assertFn = assertAllTargetsOutput,
) =>
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

section("Whole-value stores by range");

storeCase(
	"a slice or map range assigns through *p into the pointee",
	"",
	`	s := S{1}
	p := &s
	for _, *p = range []S{{5}} {
	}
	fmt.Println(s)
	for _, *p = range map[int]S{1: {6}} {
	}
	fmt.Println(s)
	var k int
	for k, *p = range map[int]S{2: {7}} {
	}
	fmt.Println(k, s)`,
	"{5}\n{6}\n2 {7}\n",
	assertAllTargetsOutput,
);

storeCase(
	"a slice or map range into an address-taken struct updates it in place",
	"",
	`	s := S{1}
	ps := &s
	for _, s = range []S{{2}} {
	}
	fmt.Println(*ps, ps == &s)
	s = S{1}
	for _, s = range map[int]S{1: {3}} {
	}
	fmt.Println(*ps, ps == &s)`,
	"{2} true\n{3} true\n",
);

storeCase(
	"a slice or map range into a sliced array updates the slice view",
	"",
	`	var arr [2]int
	sl := arr[:]
	for _, arr = range [][2]int{{7, 8}} {
	}
	fmt.Println(sl)
	for _, arr = range map[int][2]int{1: {5, 6}} {
	}
	fmt.Println(sl)`,
	"[7 8]\n[5 6]\n",
);

storeCase(
	"a range into a generic *T target stores struct, array and int values",
	`func fromSlice[T any](p *T, xs []T) {
	for _, *p = range xs {
	}
}

func fromMap[T any](p *T, m map[string]T) {
	for _, *p = range m {
	}
}`,
	`	var s S
	var arr [2]int
	var n int
	xs := [][2]int{{1, 2}}
	fromSlice(&s, []S{{5}})
	fromSlice(&arr, xs)
	fromSlice(&n, []int{5})
	fmt.Println(s, arr, n)
	fromMap(&s, map[string]S{"a": {6}})
	am := map[string][2]int{"a": {3, 4}}
	fromMap(&arr, am)
	fromMap(&n, map[string]int{"a": 6})
	arr[0] = 9
	fmt.Println(s, arr, n, xs, am)`,
	"{5} [1 2] 5\n{6} [9 4] 6 [[1 2]] map[a:[3 4]]\n",
	assertAllTargetsOutput,
);

storeCase(
	"a tuple store mixes an address-taken struct and a *p target",
	"",
	`	a, b := S{1}, S{2}
	pa, pb := &a, &b
	q := &b
	a, *q = S{3}, S{4}
	fmt.Println(*pa, pa == &a, *pb, pb == &b)`,
	"{3} true {4} true\n",
	assertAllTargetsOutput,
);

section("Whole-value stores from calls and through array pointers");

const PAIRS = `func pairS() (S, bool)      { return S{5}, true }
func pairA() ([2]int, bool) { return [2]int{7, 8}, true }`;

storeCase(
	"a multi-value call into an address-taken struct updates it in place",
	PAIRS,
	`	s := S{1}
	ps := &s
	var ok bool
	s, ok = pairS()
	fmt.Println(*ps, ps == &s, ok)`,
	"{5} true true\n",
);

storeCase(
	"a multi-value call into a sliced array updates the slice view",
	PAIRS,
	`	var arr [2]int
	sl := arr[:]
	var ok bool
	arr, ok = pairA()
	fmt.Println(sl, ok)`,
	"[7 8] true\n",
);

storeCase(
	"a multi-value call into an address-taken field and a map element stores both",
	`func pairSI() (S, int) { return S{5}, 3 }`,
	`	type W struct{ In S }
	var w W
	pin := &w.In
	m := map[string]int{}
	w.In, m["a"] = pairSI()
	fmt.Println(*pin, m)`,
	"{5} map[a:3]\n",
);

storeCase(
	"a for post statement storing a multi-value call updates in place",
	PAIRS,
	`	var arr [2]int
	sl := arr[:]
	u := S{1}
	pu := &u
	var ok bool
	for i := 0; i < 1; arr, ok = pairA() {
		i++
	}
	fmt.Println(sl, ok)
	for i := 0; i < 1; u, ok = pairS() {
		i++
	}
	fmt.Println(*pu, pu == &u, ok)`,
	"[7 8] true\n{5} true true\n",
);

storeCase(
	"a multi-value call through *p of an array updates the slice view",
	PAIRS,
	`	arr := [2]int{1, 2}
	sl := arr[:]
	p := &arr
	var ok bool
	*p, ok = pairA()
	fmt.Println(sl, ok)`,
	"[7 8] true\n",
);

storeCase(
	"an assignment through *p of an array updates the slice view",
	"type A [2]int",
	`	arr := [2]int{1, 2}
	sl := arr[:]
	p := &arr
	*p = [2]int{3, 4}
	fmt.Println(sl, arr)
	var na A
	nsl := na[:]
	pn := &na
	*pn = A{1, 1}
	fmt.Println(nsl)
	b := [2]int{5, 6}
	*p = b
	b[0] = 0
	fmt.Println(sl, b)
	*p, *pn = [2]int{2, 2}, A{3, 3}
	fmt.Println(sl, nsl)`,
	"[3 4] [3 4]\n[1 1]\n[5 6] [0 6]\n[2 2] [3 3]\n",
);

storeCase(
	"a comma-ok map read, type assertion and range through *p of an array update the slice view",
	"",
	`	arr := [2]int{1, 2}
	sl := arr[:]
	p := &arr
	m := map[string][2]int{"k": {5, 6}}
	var ok bool
	*p, ok = m["k"]
	fmt.Println(sl, ok)
	var a any = [2]int{7, 8}
	*p, ok = a.([2]int)
	fmt.Println(sl, ok)
	for _, *p = range [][2]int{{9, 10}} {
	}
	fmt.Println(sl)`,
	"[5 6] true\n[7 8] true\n[9 10]\n",
);

storeCase(
	"a store into an array of arrays keeps the slice views of its rows",
	"type T struct{ M [2][2]int }",
	`	m := [2][2]int{{1, 2}, {3, 4}}
	sl := m[0][:]
	p := &m
	*p = [2][2]int{{5, 6}, {7, 8}}
	fmt.Println(sl, m)
	m = [2][2]int{{9, 10}, {11, 12}}
	fmt.Println(sl, *p)
	var t T
	ts := t.M[1][:]
	pt := &t
	t = T{M: [2][2]int{{5, 6}, {7, 8}}}
	fmt.Println(ts, *pt)`,
	"[5 6] [[5 6] [7 8]]\n[9 10] [[9 10] [11 12]]\n[7 8] {[[5 6] [7 8]]}\n",
);

section("Conversions share or copy like Go");

test("a struct self-conversion T(src) copies the value", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T struct{ X, Y int }
type G[V any] struct {
	X V
	Y int
}

func main() {
	src := T{1, 2}
	dst := T(src)
	dst.X = 2
	fmt.Println(src.X, dst.X)
	gs := G[int]{1, 2}
	gdst := G[int](gs)
	gdst.X = 2
	fmt.Println(gs.X, gdst.X)
}
`,
		"1 2\n1 2\n",
	);
});

test("a conversion to a distinct struct type still copies", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T struct{ X, Y int }
type U struct{ X, Y int }

func main() {
	src := T{1, 2}
	u := U(src)
	u.X = 2
	fmt.Println(src.X, u.X)
}
`,
		"1 2\n",
	);
});

test("a struct self-conversion copies array fields", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T struct{ A [2]int }

func main() {
	src := T{[2]int{1, 2}}
	dst := T(src)
	dst.A[0] = 9
	fmt.Println(src.A, dst.A)
}
`,
		"[1 2] [9 2]\n",
	);
});

test("slice-to-slice conversions share the backing array", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Ints []int
type B []byte

func conv[S ~[]int](s S) []int { return []int(s) }

func main() {
	s := []int{1, 2}
	t := []int(s)
	t[0] = 99
	fmt.Println(s[0], t[0])

	b := []byte("ab")
	tb := []byte(b)
	tb[0] = 'Z'
	fmt.Println(string(b), string(tb))

	n := Ints{7, 8}
	m := []int(n)
	m[0] = 9
	fmt.Println(n[0], m[0])

	nb := B("ab")
	xb := []byte(nb)
	xb[0] = 'Z'
	fmt.Println(string(nb))

	g := Ints{1, 2}
	gc := conv(g)
	gc[1] = 8
	fmt.Println(g[1])

	r := []rune("hé")
	r2 := []rune(r)
	r2[0] = 'X'
	fmt.Println(string(r), string(r2))
}
`,
		"99 99\nZb Zb\n9 9\nZb\n8\nXé Xé\n",
	);
});

test("converting to a named slice shares and []byte(string) copies", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Ints []int

func main() {
	s := []int{1, 2}
	n := Ints(s)
	n[0] = 5
	fmt.Println(s[0])

	str := "ab"
	b := []byte(str)
	b[0] = 'Z'
	fmt.Println(str, string(b))

	var ns []int
	fmt.Println([]int(ns) == nil)
}
`,
		"5\nab Zb\ntrue\n",
	);
});

section("Whole-struct stores through pointers");

const ptrStoreCase = (name, decls, body, want) =>
	test(name, async () => {
		await assertAllTargetsOutput(
			`package main

import "fmt"

type T struct{ M [2]int }
type Inner struct{ M [2]int }
type Outer struct{ In Inner }

${decls}

func main() {
${body}
}
`,
			want,
		);
	});

ptrStoreCase(
	"*pt = T{...} keeps slices of array fields live",
	"",
	`	var t T
	s := t.M[:]
	pt := &t
	*pt = T{M: [2]int{1, 2}}
	fmt.Println(s)`,
	"[1 2]\n",
);

ptrStoreCase(
	"*po = Outer{...} keeps slices of nested array fields live",
	"",
	`	var o Outer
	s := o.In.M[:]
	po := &o
	*po = Outer{In: Inner{M: [2]int{3, 4}}}
	fmt.Println(s)`,
	"[3 4]\n",
);

ptrStoreCase(
	"a generic *p = v keeps slices of array fields live",
	"func set[V any](p *V, v V) { *p = v }",
	`	var t T
	s := t.M[:]
	set(&t, T{M: [2]int{5, 6}})
	fmt.Println(s)`,
	"[5 6]\n",
);

ptrStoreCase(
	"*pt = other keeps slices live and does not alias other",
	"",
	`	var t T
	s := t.M[:]
	other := T{M: [2]int{4, 5}}
	pt := &t
	*pt = other
	other.M[0] = 0
	fmt.Println(s, t.M, other.M)`,
	"[4 5] [4 5] [0 5]\n",
);

ptrStoreCase(
	"*t = T{...} in a pointer-receiver method keeps slices live",
	"func (t *T) reset() { *t = T{M: [2]int{8, 9}} }",
	`	var t T
	s := t.M[:]
	t.reset()
	fmt.Println(s)`,
	"[8 9]\n",
);

ptrStoreCase(
	"*p = T{...} on &arr[0] keeps slices live",
	"",
	`	var arr [2]T
	s := arr[0].M[:]
	p := &arr[0]
	*p = T{M: [2]int{6, 7}}
	fmt.Println(s)`,
	"[6 7]\n",
);

ptrStoreCase(
	"*pt, n = mk() keeps slices live",
	"func mk() (T, int) { return T{M: [2]int{1, 2}}, 3 }",
	`	var t T
	s := t.M[:]
	pt := &t
	var n int
	*pt, n = mk()
	fmt.Println(s, n)`,
	"[1 2] 3\n",
);

ptrStoreCase(
	"*pu, n = T{...}, 6 keeps slices live",
	"",
	`	var u T
	s := u.M[:]
	pu := &u
	var n int
	*pu, n = T{M: [2]int{4, 5}}, 6
	fmt.Println(s, n)`,
	"[4 5] 6\n",
);

ptrStoreCase(
	"a generic multi-value *p store keeps slices live",
	"func setm[V any](p *V, v V) { var n int; *p, n = v, 1; _ = n }",
	`	var t T
	s := t.M[:]
	setm(&t, T{M: [2]int{9, 8}})
	fmt.Println(s)`,
	"[9 8]\n",
);

ptrStoreCase(
	"direct stores without a pointer keep slices live",
	"",
	`	var t T
	s := t.M[:]
	t = T{M: [2]int{1, 2}}
	fmt.Println(s)
	var w Outer
	ws := w.In.M[:]
	w.In = Inner{M: [2]int{3, 4}}
	fmt.Println(ws)
	var a [2]int
	as := a[:]
	a = [2]int{5, 6}
	fmt.Println(as)`,
	"[1 2]\n[3 4]\n[5 6]\n",
);

test("a whole-value store evaluates the target's operands before the right-hand side", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T struct {
	M [2]int
	X int
}
type S struct{ X int }

func (t *T) reset(v func() T) { *t = v() }

func ptrOf[V any](log *string, p *V) *V { *log += "L"; return p }
func setg[V any](log *string, p *V, v func() V) { *ptrOf(log, p) = v() }
func setgm[V any](log *string, p *V, v func() V) { *ptrOf(log, p), _ = v(), 1 }

func main() {
	order := ""
	var t T
	var s S
	var a [2]int
	var xs [2][2]int
	var ts [2]T
	px, pts := &xs[0], &ts[0]
	_, _ = px, pts
	getP := func() *T { order += "L"; return &t }
	getV := func() T { order += "R"; return T{M: [2]int{1, 2}, X: 3} }
	getSP := func() *S { order += "L"; return &s }
	getSV := func() S { order += "R"; return S{4} }
	getAP := func() *[2]int { order += "L"; return &a }
	getAV := func() [2]int { order += "R"; return [2]int{5, 6} }
	idx := func() int { order += "L"; return 1 }
	show := func(what string) { fmt.Println(what, order); order = "" }

	*getP() = getV()
	show("struct")
	*getP(), _ = getV(), 1
	show("multi")
	*getSP() = getSV()
	show("flat")
	*getAP() = getAV()
	show("array")
	*getAP(), _ = getAV(), 1
	show("array multi")
	xs[idx()] = getAV()
	show("element")
	ts[idx()] = getV()
	show("struct element")
	setg(&order, &t, getV)
	show("generic")
	setgm(&order, &t, getV)
	show("generic multi")
	setg(&order, &a, getAV)
	show("generic array")
	(&t).reset(getV)
	fmt.Println(t.M, t.X, s.X, a, xs[1], ts[1].M)
}
`,
		"struct LR\nmulti LR\nflat LR\narray LR\narray multi LR\nelement LR\nstruct element LR\ngeneric LR\ngeneric multi LR\ngeneric array LR\n[1 2] 3 4 [5 6] [5 6] [1 2]\n",
	);
});

// The Go spec leaves open whether `pt` is read before or after a call on the
// right-hand side (gc happens to read it after).  GoFront reads the pointer
// first on every target, as it does for a struct without array fields.
test("*pt = f() reads the pointer before f reassigns it, on every target", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T struct {
	M [2]int
	X int
}

func main() {
	t1 := T{M: [2]int{1, 2}, X: 1}
	t2 := T{M: [2]int{3, 4}, X: 2}
	pt := &t1
	*pt = func() T { pt = &t2; return T{M: [2]int{9, 9}, X: 9} }()
	fmt.Println(t1.M, t1.X, t2.M, t2.X)
	t1 = T{M: [2]int{1, 2}, X: 1}
	t2 = T{M: [2]int{3, 4}, X: 2}
	pt = &t1
	var n int
	*pt, n = func() (T, int) { pt = &t2; return T{M: [2]int{9, 9}, X: 9}, 5 }()
	fmt.Println(t1.M, t1.X, t2.M, t2.X, n)
}
`,
		"[9 9] 9 [3 4] 2\n[9 9] 9 [3 4] 2 5\n",
	);
});

test("a generic *p store into an array pointee keeps slices of it live", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T struct{ M [2]int }
type Arr [2]int

func set[V any](p *V, v V) { *p = v }

func setOk[V any](p *V, m map[string]V) bool {
	var ok bool
	*p, ok = m["k"]
	return ok
}

func setAssert[V any](p *V, a any) {
	*p, _ = a.(V)
}

func setRange[V any](p *V, xs []V) {
	for _, *p = range xs {
	}
}

func setMulti[V any](p *V, v V) int {
	var n int
	*p, n = v, 1
	return n
}

func main() {
	var a [2]int
	s := a[:]
	set(&a, [2]int{5, 6})
	fmt.Println(s)

	var b [2]byte
	bs := b[:]
	set(&b, [2]byte{3, 4})
	fmt.Println(bs)

	var na Arr
	ns := na[:]
	set(&na, Arr{7, 8})
	fmt.Println(ns)

	var f [2]float64
	fs := f[:]
	set(&f, [2]float64{1.5, 2.5})
	fmt.Println(fs)

	var ta [2]T
	inner := ta[1].M[:]
	set(&ta, [2]T{{M: [2]int{1, 1}}, {M: [2]int{2, 2}}})
	fmt.Println(inner)

	var aa [2][2]int
	in2 := aa[1][:]
	set(&aa, [2][2]int{{1, 2}, {3, 4}})
	fmt.Println(in2)

	var t T
	tm := t.M[:]
	set(&t.M, [2]int{4, 4})
	fmt.Println(tm)

	src := [2]int{1, 2}
	var dst [2]int
	ds := dst[:]
	set(&dst, src)
	src[0] = 9
	fmt.Println(ds, dst)

	var c [2]int
	cs := c[:]
	ok := setOk(&c, map[string][2]int{"k": {1, 9}})
	fmt.Println(cs, ok)

	var d [2]int
	dss := d[:]
	setAssert(&d, [2]int{2, 8})
	fmt.Println(dss)

	var e [2]int
	es := e[:]
	setRange(&e, [][2]int{{1, 1}, {3, 7}})
	fmt.Println(es)

	var g [2]int
	gs := g[:]
	n := setMulti(&g, [2]int{6, 5})
	fmt.Println(gs, n)

	x := 1
	set(&x, 5)
	var sl []int
	set(&sl, []int{1})
	fmt.Println(x, sl)
}
`,
		"[5 6]\n[3 4]\n[7 8]\n[1.5 2.5]\n[2 2]\n[3 4]\n[4 4]\n[1 2] [1 2]\n[1 9] true\n[2 8]\n[3 7]\n[6 5] 1\n5 [1]\n",
	);
});

test("conversions from a slice-or-string type parameter follow the type argument", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type B []byte
type R []rune
type Str string

func conv[S ~[]byte | ~string](s S) []byte { return []byte(s) }
func convR[S ~[]rune | ~string](s S) []rune  { return []rune(s) }
func strR[S ~[]rune | ~string](s S) string   { return string(s) }
func strB[S ~[]byte | ~string](s S) string   { return string(s) }
func convU[S interface{ []uint8 | B }](s S) []byte { return []byte(s) }
func convN[S B | ~string](s S) []byte        { return []byte(s) }
func convNB[S B | []byte](s S) B             { return B(s) }
func convStr[S ~string](s S) []byte          { return []byte(s) }
func convStrR[S ~string](s S) []rune         { return []rune(s) }
func toStr[S ~[]byte | ~string](s S) Str      { return Str(s) }

func strMix[S ~[]byte | ~[]rune | ~string](s S) string { return string(s) }
func strMixI[S ~int32 | ~int64 | ~string](s S) string  { return string(s) }
func runesOf[S ~[]rune | ~string](s S) int             { return len([]rune(s)) }

func main() {
	b := []byte("ab")
	tb := conv(b)
	tb[0] = 'Z'
	sb := conv("ab")
	sb[0] = 'Z'
	fmt.Println(string(b), string(tb))
	fmt.Println(string(sb), len(sb))
	var nb []byte
	fmt.Println(conv(nb) == nil, len(conv("")))

	r := []rune("hé")
	tr := convR(r)
	tr[0] = 'X'
	sr := convR("hé")
	sr[0] = 'Y'
	fmt.Println(string(r), string(tr), string(sr), len(sr))
	fmt.Println(strR(r), strR("ok"), strB(b), strB("ok2"))

	u := []uint8("cd")
	tu := convU(u)
	tu[0] = 'Q'
	fmt.Println(string(u))

	nbv := B("ef")
	tn := convN(nbv)
	tn[0] = 'W'
	fmt.Println(string(nbv), string(convN("gh")))

	x := []byte("ij")
	y := convNB(x)
	y[0] = 'V'
	fmt.Println(string(x))

	fmt.Println(string(convStr(Str("kl"))), string(convStrR("mn")))
	fmt.Println(toStr(b), toStr("op"))

	var nr []rune
	var nb2 []byte
	fmt.Println(string(nr) == "", strMix(nr) == "", strMix(nb2) == "", strR(nr) == "")
	fmt.Println(strMix([]rune("xé")), strMix([]byte("y")), strMix("z"))
	fmt.Println(strMixI(int32(65)), strMixI(int64(66)), strMixI("w"))
	fmt.Println(runesOf("hé"), runesOf([]rune("abc")))
}
`,
		"Zb Zb\nZb 2\ntrue 0\nXé Xé Yé 2\nXé ok Zb ok2\nQd\nWf gh\nVj\nkl mn\nZb op\ntrue true true true\nxé y z\nA B w\n2 3\n",
	);
});

test("an array conversion from a slice type parameter copies the elements", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func toArr[S ~[]int](s S) [2]int { return [2]int(s) }

func main() {
	s := []int{1, 2, 3}
	a := toArr(s)
	a[0] = 9
	fmt.Println(s, a)
}
`,
		"[1 2 3] [9 2]\n",
	);
});

test("a generic *p store into a generic struct copies its array fields into the existing storage", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type G[E any] struct{ M [2]E }
type N[E any] struct {
	A [2][2]E
	In G[E]
}

func set[V any](p *V, v V) { *p = v }
func zeroArr[E any]() [2]E     { var a [2]E; return a }
func mkArr[E any](x, y E) [2]E { return [2]E{x, y} }
func mkG[E any](x, y E) G[E]   { return G[E]{M: [2]E{x, y}} }

func probe[E any](x, y E) {
	var g G[E]
	sg := g.M[:]
	set(&g, G[E]{M: [2]E{x, y}})
	fmt.Println(sg)
}

func main() {
	var gb G[byte]
	sb := gb.M[:]
	set(&gb, G[byte]{M: [2]byte{10, 20}})
	var gi G[int]
	si := gi.M[:]
	set(&gi, G[int]{M: [2]int{1, 2}})
	var gf G[float64]
	sf := gf.M[:]
	set(&gf, G[float64]{M: [2]float64{1.5, 2.5}})
	var gu G[uint16]
	su := gu.M[:]
	set(&gu, G[uint16]{M: [2]uint16{300, 400}})
	var g8 G[int8]
	s8 := g8.M[:]
	set(&g8, G[int8]{M: [2]int8{-1, 5}})
	var gbo G[bool]
	sbo := gbo.M[:]
	set(&gbo, G[bool]{M: [2]bool{true, false}})
	var gs G[string]
	ss := gs.M[:]
	set(&gs, G[string]{M: [2]string{"a", "b"}})
	var ga G[[2]byte]
	sa := ga.M[1][:]
	set(&ga, G[[2]byte]{M: [2][2]byte{{1, 2}, {3, 4}}})
	fmt.Println(sb, si, sf, su, s8, sbo, ss, sa)

	var n N[byte]
	na := n.A[1][:]
	ni := n.In.M[:]
	set(&n, N[byte]{A: [2][2]byte{{1, 2}, {3, 4}}, In: G[byte]{M: [2]byte{5, 6}}})
	fmt.Println(na, ni)

	// generic-built values into concrete storage and back
	var b [2]byte
	bs := b[:]
	set(&b, mkArr[byte](3, 4))
	z := zeroArr[byte]()
	zs := z[:]
	set(&z, [2]byte{7, 8})
	var g2 G[byte]
	g2s := g2.M[:]
	set(&g2, mkG[byte](9, 10))
	z16 := zeroArr[uint16]()
	z16s := z16[:]
	set(&z16, [2]uint16{11, 12})
	zf := zeroArr[float32]()
	zfs := zf[:]
	set(&zf, [2]float32{1.25, 2})
	fmt.Println(bs, zs, g2s, z16s, zfs)
	var gi64 G[int64]
	si64 := gi64.M[:]
	set(&gi64, G[int64]{M: [2]int64{1 << 40, -3}})
	fmt.Println(si64)

	probe[byte](1, 2)
	probe[int8](-3, 4)
	probe[string]("x", "y")
	// direct store, no generic
	var g3 G[byte]
	g3s := g3.M[:]
	g3 = G[byte]{M: [2]byte{13, 14}}
	pg := &g3
	fmt.Println(g3s)
	*pg = G[byte]{M: [2]byte{15, 16}}
	fmt.Println(g3s)
	g3.M = [2]byte{17, 18}
	fmt.Println(g3s)
}
`,
		"[10 20] [1 2] [1.5 2.5] [300 400] [-1 5] [true false] [a b] [3 4]\n[3 4] [5 6]\n[3 4] [7 8] [9 10] [11 12] [1.25 2]\n[1099511627776 -3]\n[1 2]\n[-3 4]\n[x y]\n[13 14]\n[15 16]\n[17 18]\n",
	);
});

test("a named slice conversion from a string type parameter builds a new slice", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type B []byte
type R []rune
type Str string

func toB[S ~[]byte | ~string](s S) B    { return B(s) }
func toR[S ~[]rune | ~string](s S) R    { return R(s) }
func strB[S ~string](s S) B             { return B(s) }
func strR[S ~string](s S) R             { return R(s) }
func bytesB[S ~[]byte](s S) B           { return B(s) }
func runesR[S ~[]rune](s S) R           { return R(s) }
func toBU[S ~[]uint8 | ~string](s S) B  { return B(s) }

func main() {
	b := toB("pq")
	b[0] = 'P'
	src := []byte("xy")
	b2 := toB(src)
	b2[0] = 'X'
	b3 := toB(Str("ab"))
	b3[1] = 'B'
	var nb []byte
	fmt.Println(string(b), string(src), string(b3), toB(nb) == nil, len(toB("")))
	r := toR("hé")
	r[0] = 'H'
	rs := []rune("ok")
	r2 := toR(rs)
	r2[0] = 'O'
	fmt.Println(string(r), string(rs), len(r))
	c := strB(Str("mn"))
	c[0] = 'M'
	d := strR("ü!")
	d[1] = '?'
	fmt.Println(string(c), string(d), len(d))
	e := bytesB(src)
	e[1] = 'Y'
	f := runesR(rs)
	f[1] = 'K'
	fmt.Println(string(src), string(rs))
	g := toBU("uv")
	g[0] = 'U'
	fmt.Println(string(g))
	fmt.Printf("%T %T\\n", b, r)
}
`,
		"Pq Xy aB true 0\nHé Ok 2\nMn ü? 2\nXY OK\nUv\nmain.B main.R\n",
	);
});

test("an array conversion from a slice copies struct and array elements", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T struct{ M [2]int }
type P struct{ X *int }
type A2 [2]int

func toArrMix[S ~[]int | ~[2]int](s S) [2]int { return [2]int(s) }
func toArr[S ~[]T](s S) [2]T                   { return [2]T(s) }
func toArrTMix[S ~[]T | ~[2]T](s S) [2]T        { return [2]T(s) }
func toNested[S ~[][2]int](s S) [2][2]int       { return [2][2]int(s) }
func toElem[E any](s []E) [2]E                  { return [2]E(s) }
func toNamed[S ~[]int | ~[2]int](s S) A2        { return A2(s) }
func toBytes[S ~[]byte | ~[2]byte](s S) [2]byte { return [2]byte(s) }

func main() {
	s := []int{1, 2, 3}
	a := toArrMix(s)
	a[0] = 99
	fmt.Println(s, a)
	arr := [2]int{4, 5}
	a2 := toArrMix(arr)
	a2[0] = 98
	fmt.Println(arr, a2)
	n := toNamed(s[1:])
	n[0] = 97
	fmt.Println(s, n)
	bs := []byte{1, 2, 3}
	b := toBytes(bs)
	b[0] = 9
	ba := [2]byte{7, 8}
	b2 := toBytes(ba)
	b2[1] = 0
	fmt.Println(bs, b, ba, b2)

	ts := []T{{M: [2]int{1, 2}}, {M: [2]int{3, 4}}}
	ta := toArr(ts)
	ta[0].M[0] = 99
	fmt.Println(ts[0].M, ta[0].M)
	tm := toArrTMix(ts)
	tm[1].M[1] = 88
	tarr := [2]T{{M: [2]int{5, 6}}, {}}
	tm2 := toArrTMix(tarr)
	tm2[0].M[0] = 77
	fmt.Println(ts[1].M, tm[1].M, tarr[0].M, tm2[0].M)

	// concrete form
	ca := [2]T(ts)
	ca[0].M[1] = 66
	fmt.Println(ts[0].M, ca[0].M)
	ns := [][2]int{{1, 2}, {3, 4}}
	cn := [2][2]int(ns)
	cn[1][0] = 55
	gn := toNested(ns)
	gn[0][0] = 44
	fmt.Println(ns, cn, gn)
	ge := toElem(ts)
	ge[1].M[0] = 33
	gi := toElem([]int{6, 7})
	fmt.Println(ts[1].M, ge[1].M, gi)
	x := 1
	ps := []P{{&x}, {&x}}
	pa := [2]P(ps)
	*pa[0].X = 5
	fmt.Println(x, pa[0].X == ps[0].X)
	sub := ts[1:]
	one := [1]T(sub)
	one[0].M[0] = 11
	fmt.Println(ts[1].M, one[0].M)
	anon := []struct{ M [1]int }{{M: [1]int{1}}}
	aa := [1]struct{ M [1]int }(anon)
	aa[0].M[0] = 2
	fmt.Println(anon[0].M, aa[0].M)
}
`,
		"[1 2 3] [99 2]\n[4 5] [98 5]\n[1 2 3] [97 3]\n[1 2 3] [9 2] [7 8] [7 0]\n[1 2] [99 2]\n[3 4] [3 88] [5 6] [77 6]\n[1 2] [1 66]\n[[1 2] [3 4]] [[1 2] [55 4]] [[44 2] [3 4]]\n[3 4] [33 4] [6 7]\n5 true\n[3 4] [11 4]\n[1] [2]\n",
	);
});

test("an array conversion from a short slice panics and a nil slice converts to [0]T", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func toArrMix[S ~[]int | ~[2]int](s S) [2]int { return [2]int(s) }

func try(f func()) {
	defer func() { fmt.Println(recover()) }()
	f()
}

func main() {
	try(func() { fmt.Println([2]int([]int{1})) })
	try(func() { fmt.Println(toArrMix([]int{7})) })
	try(func() { var nb []byte; fmt.Println([0]byte(nb), [2]byte([]byte("ab"))) })
}
`,
		"runtime error: cannot convert slice with length 1 to array or pointer to array with length 2\nruntime error: cannot convert slice with length 1 to array or pointer to array with length 2\n[] [97 98]\n<nil>\n",
	);
});

test("a generic *p store handles SIMD vectors and masks directly, in structs, and in arrays", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"fmt"
	"gofront/simd"
)

type S struct {
	V simd.F32x4
	M simd.Mask32x4
}

type G[E any] struct {
	M [2]E
	X E
}

type Outer struct {
	In S
	A  [2][2]simd.F32x4
}

func set[V any](p *V, v V) { *p = v }
func swap[V any](a, b *V)  { *a, *b = *b, *a }
func id[V any](v V) V      { return v }

func main() {
	v1 := simd.F32x4{1, 2, 3, 4}
	v2 := simd.F32x4{5, 6, 7, 8}
	m1 := v1.Equal(simd.F32x4{1, 0, 3, 0})
	m2 := m1.Not()

	// direct *V
	var dv simd.F32x4
	set(&dv, v1)
	var dm simd.Mask32x4
	set(&dm, m1)
	fmt.Println(dv, dm)

	// struct fields (named & anonymous)
	var s S
	set(&s, S{V: v1, M: m1})
	var anon struct {
		V simd.F32x4
		M simd.Mask32x4
	}
	set(&anon, struct {
		V simd.F32x4
		M simd.Mask32x4
	}{V: v2, M: m2})
	fmt.Println(s.V, s.M, anon.V, anon.M)

	// generic struct [2]E and E fields keep array slice storage
	var gf G[simd.F32x4]
	sf := gf.M[:]
	set(&gf, G[simd.F32x4]{M: [2]simd.F32x4{v1, v2}, X: v2})
	var gm G[simd.Mask32x4]
	sm := gm.M[:]
	set(&gm, G[simd.Mask32x4]{M: [2]simd.Mask32x4{m1, m2}, X: m2})
	fmt.Println(gf.M[0], sf[1], gf.X, gm.M[0], sm[1], gm.X)

	// direct [2]simd.F32x4 / [2]simd.Mask32x4 keep slice storage
	var af [2]simd.F32x4
	saf := af[:]
	set(&af, [2]simd.F32x4{v1, v2})
	var am [2]simd.Mask32x4
	sam := am[:]
	set(&am, [2]simd.Mask32x4{m1, m2})
	fmt.Println(saf[0], saf[1], sam[0], sam[1])

	// nested struct + 2D array
	var out Outer
	row := out.A[1][:]
	set(&out, Outer{In: S{V: v1, M: m1}, A: [2][2]simd.F32x4{{v1, v2}, {v2, v1}}})
	fmt.Println(out.In.V, out.In.M, row[0], row[1])

	// tuple swap and value copy
	a, b := v1, v2
	swap(&a, &b)
	ma, mb := m1, m2
	swap(&ma, &mb)
	fmt.Println(a, b, ma, mb, id(v1), id(m1), id(s).V, id(gf).M[0])
}
`,
		"[1 2 3 4] [true false true false]\n[1 2 3 4] [true false true false] [5 6 7 8] [false true false true]\n[1 2 3 4] [5 6 7 8] [5 6 7 8] [true false true false] [false true false true] [false true false true]\n[1 2 3 4] [5 6 7 8] [true false true false] [false true false true]\n[1 2 3 4] [true false true false] [5 6 7 8] [1 2 3 4]\n[5 6 7 8] [1 2 3 4] [false true false true] [true false true false] [1 2 3 4] [true false true false] [1 2 3 4] [1 2 3 4]\n",
	);
});

test("a generic *p store handles complex values without aliasing and keeps anonymous {re, im} structs mutable", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type SC struct {
	C128 complex128
	C64  complex64
}

type GC[E any] struct {
	M [2]E
}

func set[V any](p *V, v V) { *p = v }
func get[V any](p *V) V    { return *p }

func main() {
	var c complex128
	set(&c, complex(1, 2))
	var c64 complex64
	set(&c64, complex(float32(3), float32(4)))
	fmt.Println(c, c64, get(&c), get(&c64))

	s := SC{C128: complex(1, 2), C64: complex(float32(5), float32(6))}
	prev128, prev64 := s.C128, s.C64
	set(&s, SC{C128: complex(7, 8), C64: complex(float32(9), float32(10))})
	fmt.Println(prev128, prev64, s.C128, s.C64)

	var gc GC[complex128]
	gc.M[0] = complex(1, 1)
	sl := gc.M[:]
	prevElem := gc.M[0]
	set(&gc, GC[complex128]{M: [2]complex128{complex(2, 3), complex(4, 5)}})
	fmt.Println(prevElem, sl[0], sl[1])

	var reIm struct {
		re, im float64
	}
	set(&reIm, struct {
		re, im float64
	}{re: 11, im: 12})
	fmt.Println(reIm.re, reIm.im)
}
`,
		"(1+2i) (3+4i) (1+2i) (3+4i)\n(1+2i) (5+6i) (7+8i) (9+10i)\n(1+1i) (2+3i) (4+5i)\n11 12\n",
	);
});
