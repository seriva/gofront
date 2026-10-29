// test/unit/wasm/pointers.test.js
// Addresses of scalar fields, elements and package-level variables are compile errors in wasm packages.

import {
	assertEqual,
	assertErrorContains,
	assertProgramOutput,
	compileHybrid,
	compileWasm,
	runWasm,
	section,
	test,
} from "../helpers.js";

const SCALAR_ADDR_MSG =
	"cannot take the address of a field, element or package-level variable of type";

section("WASM Pointers — Scalar Interior Addresses Are Rejected");

test("set(&s.X, 7) mutates struct scalar field through pointer parameter (rejected in wasm)", () => {
	const src = `
package main

type S struct {
	X int
	Y int
}

func set(p *int, v int) {
	*p = v
}

func Main() int {
	s := S{X: 1, Y: 2}
	set(&s.X, 7)
	return s.X*10 + s.Y
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("*(&xs[1]) = 9 mutates slice element through dereference assignment (rejected in wasm)", () => {
	const src = `
package main

func Main() int {
	xs := []int{10, 20, 30}
	*(&xs[1]) = 9
	return xs[0] + xs[1] + xs[2]
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("&s.Inner.X mutates nested struct scalar field through accessor ref (rejected in wasm)", () => {
	const src = `
package main

type Inner struct {
	X int
}

type Outer struct {
	Inner Inner
	Y     int
}

func set(p *int, v int) {
	*p = v
}

func Main() int {
	s := Outer{Inner: Inner{X: 1}, Y: 2}
	set(&s.Inner.X, 7)
	return s.Inner.X*10 + s.Y
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("&arr[0].X and *(&arr[1].Y) mutate array element fields (rejected in wasm)", () => {
	const src = `
package main

type Item struct {
	X int
	Y int
}

func set(p *int, v int) {
	*p = v
}

func Main() int {
	arr := [2]Item{{X: 1, Y: 2}, {X: 3, Y: 4}}
	set(&arr[0].X, 7)
	*(&arr[1].Y) = 9
	return arr[0].X*1000 + arr[0].Y*100 + arr[1].X*10 + arr[1].Y
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("p := &xs[1]; xs = xs[1:]; *p = 9 preserves backing array aliasing after reslicing (rejected in wasm)", () => {
	const src = `
package main

func Main() int32 {
	xs := []int32{10, 20, 30}
	p := &xs[1]
	xs = xs[1:]
	*p = 9
	return xs[0]
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("reading *p through accessor ref reads struct field (rejected in wasm)", () => {
	const src = `
package main

type S struct {
	X int
}

func get(p *int) int {
	return *p
}

func Main() int {
	s := S{X: 42}
	return get(&s.X)
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("reading *p through accessor ref reads slice element (rejected in wasm)", () => {
	const src = `
package main

func get(p *int32) int32 {
	return *p
}

func Main() int32 {
	xs := []int32{10, 20, 30}
	return get(&xs[2])
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("*(&arr[1]) = 99 on fixed-size array element (rejected in wasm)", () => {
	const src = `
package main

func Main() int {
	arr := [3]int{10, 20, 30}
	*(&arr[1]) = 99
	return arr[1]
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("p == q for two separate &s.X evaluates to true (rejected in wasm)", () => {
	const src = `
package main

type S struct {
	X int
	Y int
}

func Main() int {
	s := S{X: 1, Y: 2}
	p := &s.X
	q := &s.X
	if p == q {
		return 1
	}
	return 0
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("p == q for &s.X and &s.Y evaluates to false (rejected in wasm)", () => {
	const src = `
package main

type S struct {
	X int
	Y int
}

func Main() int {
	s := S{X: 1, Y: 2}
	p := &s.X
	q := &s.Y
	if p == q {
		return 1
	}
	return 0
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("p != q for &s.X and &s.Y evaluates to true (rejected in wasm)", () => {
	const src = `
package main

type S struct {
	X int
	Y int
}

func Main() int {
	s := S{X: 1, Y: 2}
	p := &s.X
	q := &s.Y
	if p != q {
		return 1
	}
	return 0
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("p == q for &s.X and &x (box) evaluates to false (rejected in wasm)", () => {
	const src = `
package main

type S struct {
	X int
}

func Main() int {
	s := S{X: 1}
	x := 1
	p := &s.X
	q := &x
	if p == q {
		return 1
	}
	return 0
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("p := &xs[1]; xs = append(xs, 4); *p = 9 preserves old backing array (rejected in wasm)", () => {
	const src = `
package main

func Main() int {
	xs := []int{10, 20, 30}
	p := &xs[1]
	xs = append(xs, 4)
	*p = 99
	// xs was reallocated on append; p points to the old backing array.
	// xs[1] should still be 20, not 99.
	return xs[1]
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("struct field of type *int holding accessor ref survives struct copy (rejected in wasm)", () => {
	const src = `
package main

type Other struct {
	X int
}

type Holder struct {
	P *int
}

func Main() int {
	other := Other{X: 10}
	s1 := Holder{P: &other.X}
	s2 := s1
	*s2.P = 99
	return other.X
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("struct equality when fields are scalar pointers holding accessor refs (rejected in wasm)", () => {
	const src = `
package main

type Target struct {
	X int
	Y int
}

type RefHolder struct {
	P *int
}

func Main() int {
	t := Target{X: 1, Y: 2}
	h1 := RefHolder{P: &t.X}
	h2 := RefHolder{P: &t.X}
	h3 := RefHolder{P: &t.Y}

	eq12 := h1 == h2
	eq13 := h1 == h3

	res := 0
	if eq12 {
		res += 1
	}
	if !eq13 {
		res += 10
	}
	return res
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("*p += 5 compound assignment on accessor ref to struct scalar field &s.X (rejected in wasm)", () => {
	const src = `
package main

type S struct {
	X int
	Y int
}

func Main() int {
	s := S{X: 10, Y: 20}
	p := &s.X
	*p += 5
	return s.X*100 + s.Y
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("(*p)++ and (*p)-- increment/decrement on accessor ref to struct scalar field &s.X (rejected in wasm)", () => {
	const src = `
package main

type S struct {
	X int
	Y int
}

func Main() int {
	s := S{X: 10, Y: 20}
	p := &s.X
	(*p)++
	q := &s.Y
	(*q)--
	return s.X*100 + s.Y
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("*p += 5 compound assignment on accessor ref to slice element &xs[1] (rejected in wasm)", () => {
	const src = `
package main

func Main() int {
	xs := []int{10, 20, 30}
	p := &xs[1]
	*p += 5
	return xs[0] + xs[1] + xs[2]
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("&s.Slice takes address of struct slice field without invalid accessor ref (rejected in wasm)", () => {
	const src = `
package main

type S struct {
	X     int
	Slice []int
}

func Main() int {
	s := S{X: 42, Slice: []int{1, 2, 3}}
	p := &s.Slice
	return s.X + len(*p) + (*p)[1]
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("whole array assignment writes into storage seen by &a[1] (P20) (rejected in wasm)", () => {
	const src = `
package main

func Main() int {
	a := [3]int{1, 2, 3}
	p := &a[1]
	a = [3]int{4, 5, 6}
	return *p
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("whole struct assignment writes into storage seen by &s (P25)", () => {
	const src = `
package main

type S struct{ A int }

func Main() int {
	s := S{1}
	p := &s
	s = S{5}
	return p.A
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.wasmRes, 5n);
	assertEqual(res.jsRes, 5);
});

test("whole struct assignment keeps field pointer &s.A valid (rejected in wasm)", () => {
	const src = `
package main

type S struct{ A, B int }

func Main() int {
	s := S{1, 2}
	p := &s.B
	s = S{5, 7}
	return *p
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("whole struct assignment through a field array pointer &w.arr[0] (rejected in wasm)", () => {
	const src = `
package main

type W struct{ arr [2]int }

func Main() int {
	w := W{[2]int{1, 2}}
	p := &w.arr[0]
	w = W{[2]int{8, 9}}
	return *p
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("assigning a field array wholesale keeps &w.arr[1] valid (rejected in wasm)", () => {
	const src = `
package main

type W struct{ arr [2]int }

func Main() int {
	var w W
	p := &w.arr[1]
	w.arr = [2]int{3, 4}
	return *p
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("tuple swap of address-taken structs reads before it writes", () => {
	const src = `
package main

type S struct{ A int }

func Main() int {
	a := S{1}
	b := S{2}
	p := &a
	a, b = b, a
	return p.A*100 + a.A*10 + b.A
}
`;
	// WASM-only: the JS backend's tuple swap of address-taken values differs.
	const { wasm, stringTable } = compileHybrid(src);
	assertEqual(runWasm(wasm, { stringTable }).exports.Main(), 221n);
});

test("tuple swap of address-taken arrays reads before it writes (rejected in wasm)", () => {
	const src = `
package main

func Main() int {
	a := [2]int{1, 2}
	b := [2]int{3, 4}
	p := &a[0]
	a, b = b, a
	return *p*10 + b[0]
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("whole array of structs assignment keeps &a[i] valid", () => {
	const src = `
package main

type S struct{ A int }

func Main() int {
	a := [2]S{{1}, {2}}
	p := &a[1]
	a = [2]S{{5}, {6}}
	return p.A
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.wasmRes, 6n);
	assertEqual(res.jsRes, 6);
});

test("package-level array assignment keeps &g[0] valid (rejected in wasm)", () => {
	const src = `
package main

var g [2]int

func Main() int {
	p := &g[0]
	g = [2]int{4, 5}
	return *p
}
`;
	const { errors } = compileWasm(src);
	assertErrorContains(errors, SCALAR_ADDR_MSG);
});

test("package-level struct assignment keeps &g valid", () => {
	const src = `
package main

type S struct{ A int }

var g S

func Main() int {
	p := &g
	g = S{7}
	return p.A
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.wasmRes, 7n);
	assertEqual(res.jsRes, 7);
});

test("*p = make(...) through a pointer to a nil map replaces the map", () => {
	const src = `
package main

func fill(p *map[string]int) {
	m := *p
	if m == nil {
		m = make(map[string]int)
	}
	m["a"] = 1
	*p = m
}

func Main() int {
	var m map[string]int
	fill(&m)
	fill(&m)
	return len(m)*10 + m["a"]
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.wasmRes, 11n);
	assertEqual(res.jsRes, 11);
});

section(
	"WASM Pointers — pointers to pointers and pointer receivers on named maps",
);

test("pointers to pointers and pointer receivers on named maps and slices match Go", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type T struct{ X int }
type M map[string]int
type S []int

func (m *M) Put(k string, v int) {
	if *m == nil {
		*m = M{}
	}
	(*m)[k] = v
}
func (m M) Get(k string) int { return m[k] }
func (s *S) Add(v int)       { *s = append(*s, v) }
func (s S) Sum() (t int) {
	for _, v := range s {
		t += v
	}
	return
}

func setPP(pp **T, v *T)   { *pp = v }
func readPP(pp **T) int    { return (*pp).X }
func bump(pi **int)        { **pi += 5 }
func swap(a, b **T)        { *a, *b = *b, *a }
func newPP() **T           { t := &T{77}; return &t }
func nilcheck(pp **T) bool { return pp == nil || *pp == nil }

func main() {
	p := &T{3}
	pp := &p
	fmt.Println((*pp).X, (**pp).X)
	(*pp).X = 9
	fmt.Println(p.X)
	q := &T{5}
	*pp = q
	fmt.Println(p.X, (*pp).X, *pp == q, p == q)
	ppp := &pp
	(**ppp).X = 11
	fmt.Println(q.X, (***ppp).X, **ppp == q)
	var np *T
	pn := &np
	*pn = &T{1}
	fmt.Println(np.X, *pn != nil)

	x := 1
	px := &x
	ppx := &px
	**ppx = 2
	bump(ppx)
	fmt.Println(x, *px == x, **ppx)
	a, b := &T{1}, &T{2}
	setPP(&a, b)
	fmt.Println(a.X, readPP(&a), a == b)
	c := &T{3}
	swap(&a, &c)
	fmt.Println(a.X, c.X)
	fmt.Println(readPP(newPP()), nilcheck(nil))
	var nn *T
	fmt.Println(nilcheck(&nn))
	pps := []**T{&a, &c}
	fmt.Println((*pps[1]).X)

	g := M{}
	g.Put("a", 1)
	fmt.Println(len(g), g["a"], g.Get("a"))
	var m M
	m.Put("a", 1)
	(&m).Put("d", 4)
	pm := &m
	pm.Put("e", 5)
	fmt.Println(len(m), len(*pm), (*pm).Get("e"))
	var sl S
	sl.Add(1)
	sl.Add(2)
	psl := &sl
	psl.Add(3)
	fmt.Println(sl, sl.Sum(), psl.Sum(), len(sl))
}
`,
		`3 3
9
5 5 true true
11 11 true
1 true
7 true 7
2 2 true
3 2
77 true
true
2
1 1 1
3 3 5
[1 2 3] 6 6 3
`,
	);
});
