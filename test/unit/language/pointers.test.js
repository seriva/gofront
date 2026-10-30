import { fileURLToPath } from "node:url";
import {
	assertContains,
	assertEqual,
	assertErrorContains,
	assertProgramOutput,
	compile,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

// ── Phase 1 — Type checking: & and * produce correct types ──

section("Pointer type checking");

test("& produces pointer type", () => {
	const { js, errors } = compile(`package main
func main() {
	x := 42
	p := &x
	_ = p
	println(*p)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42");
});

test("* dereferences pointer type", () => {
	const { js, errors } = compile(`package main
func main() {
	x := 10
	p := &x
	y := *p
	println(y)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "10");
});

test("error: cannot dereference non-pointer type", () => {
	const { errors } = compile(`package main
func main() {
	x := 42
	y := *x
	_ = y
}`);
	assertErrorContains(errors, "cannot dereference non-pointer type");
});

test("nil assignable to pointer type", () => {
	const { js, errors } = compile(`package main
func main() {
	var p *int
	p = nil
	_ = p
	println(p == nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

// ── Phase 3-4 — Boxed locals and shared mutation ──

section("Boxed locals and shared mutation");

test("new(int) produces { value: 0 }", () => {
	const { js, errors } = compile(`package main
func main() {
	p := new(int)
	println(*p)
	*p = 42
	println(*p)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0\n42");
});

test("address-taken int is boxed", () => {
	const { js, errors } = compile(`package main
func main() {
	x := 5
	p := &x
	println(*p)
}`);
	assertEqual(errors.length, 0);
	assertContains(js, "{ value: 5 }");
	assertEqual(runJs(js), "5");
});

test("shared mutation through pointer to int", () => {
	const { js, errors } = compile(`package main
func main() {
	x := 10
	p := &x
	*p = 20
	println(x)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "20");
});

test("swap via pointers works correctly", () => {
	const { js, errors } = compile(`package main
func swap(a *int, b *int) {
	tmp := *a
	*a = *b
	*b = tmp
}
func main() {
	x := 10
	y := 20
	swap(&x, &y)
	println(x, y)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "20 10");
});

test("struct pointer does not double-box", () => {
	const { js, errors } = compile(`package main
type Point struct {
	X int
	Y int
}
func main() {
	p := Point{X: 1, Y: 2}
	ptr := &p
	ptr.X = 10
	println(p.X)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "10");
});

test("non-address-taken variable is not boxed", () => {
	const { js, errors } = compile(`package main
func main() {
	x := 42
	println(x)
}`);
	assertEqual(errors.length, 0);
	// Should NOT contain { value: 42 } since address is never taken
	assertEqual(js.includes("{ value: 42 }"), false);
	assertEqual(runJs(js), "42");
});

test("address-taken string is boxed", () => {
	const { js, errors } = compile(`package main
func main() {
	s := "hello"
	p := &s
	*p = "world"
	println(s)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "world");
});

test("shared mutation through pointer to bool", () => {
	const { js, errors } = compile(`package main
func main() {
	b := true
	p := &b
	*p = false
	println(b)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "false");
});

// ── Phase 5 — Function parameters ──

section("Pointer function parameters");

test("pass pointer to function, mutation visible to caller", () => {
	const { js, errors } = compile(`package main
func inc(p *int) {
	*p = *p + 1
}
func main() {
	x := 10
	inc(&x)
	println(x)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "11");
});

test("return pointer from function, dereference at call site", () => {
	const { js, errors } = compile(`package main
func newInt(v int) *int {
	p := new(int)
	*p = v
	return p
}
func main() {
	p := newInt(42)
	println(*p)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42");
});

// ── Phase 7 — Pointer comparison and nil ──

section("Pointer comparison and nil");

test("pointer equality: same box returns true", () => {
	const { js, errors } = compile(`package main
func main() {
	x := 10
	p1 := &x
	p2 := &x
	println(p1 == p2)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("pointer equality: different boxes returns false", () => {
	const { js, errors } = compile(`package main
func main() {
	x := 10
	y := 10
	p1 := &x
	p2 := &y
	println(p1 == p2)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "false");
});

test("pointer to nil comparison", () => {
	const { js, errors } = compile(`package main
func main() {
	x := 10
	p := &x
	println(p == nil)
	println(p != nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "false\ntrue");
});

test("var *int defaults to nil", () => {
	const { js, errors } = compile(`package main
func main() {
	var p *int
	println(p == nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

// ── End-to-end ──

section("Pointer end-to-end");

test("closure captures address-taken variable by reference", () => {
	const { js, errors } = compile(`package main
func main() {
	x := 0
	inc := func() {
		*&x = x + 1
	}
	inc()
	inc()
	inc()
	println(x)
}`);
	// Note: &x inside closure refers to same box
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3");
});

test("multiple pointers to same variable share mutations", () => {
	const { js, errors } = compile(`package main
func main() {
	x := 1
	p1 := &x
	p2 := &x
	*p1 = 100
	println(*p2)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "100");
});

test("pointer parameter reassignment does not affect caller box", () => {
	const { js, errors } = compile(`package main
func reassign(p *int) {
	q := new(int)
	*q = 999
	// reassigning p does not affect caller's variable
	p = q
	_ = p
}
func main() {
	x := 42
	reassign(&x)
	println(x)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42");
});

section(
	"Address-taken variables from destructuring declarations and parameters",
);

test("address of variables declared together, by var, and of parameters", () => {
	// Expected output captured from Go.
	const { js, errors } = compile(`package main
import "fmt"
func pair() (int, int) { return 7, 8 }
func bump(x int) int {
	p := &x
	*p += 1
	return x
}
func main() {
	a1, a2 := 1, 2
	p := &a1
	*p = 10
	fmt.Println(a1, a2)
	x1, x2 := pair()
	q := &x2
	*q += 100
	fmt.Println(x1, x2)
	var v1, v2 = 3, 4
	r := &v2
	*r = 40
	fmt.Println(v1, v2)
	var v = 3
	pv := &v
	*pv = 30
	var a, b = pair()
	pb := &b
	*pb = 80
	fmt.Println(v, a, b, bump(4))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), ["10 2", "7 108", "3 40", "30 7 80 5"].join("\n"));
});

section("Nil pointers in JS");

const NIL_PTR_SRC = `package main

import "fmt"

type List struct {
	next *List
}

func (l *List) Len() int {
	if l == nil {
		return 0
	}
	return 1 + l.next.Len()
}

type S struct{ A int }

func main() {
	l := &List{&List{nil}}
	fmt.Println(l.Len())
	fmt.Println((*List).Len(l))
	func() {
		defer func() { fmt.Println(recover()) }()
		var p *S
		_ = *p
	}()
	xs := []int{1, 2}
	clear(xs)
	fmt.Println(xs)
}
`;

for (const target of ["js", "both"]) {
	test(`nil receivers, nil dereference and clear on ${target}`, () => {
		const { js, errors } = compile(NIL_PTR_SRC, { target });
		assertEqual(errors.length, 0);
		const out = runJs(js).split("\n");
		assertEqual(out[0], "2");
		assertEqual(out[1], "2");
		assertContains(out[2], "nil pointer dereference");
		assertEqual(out[3], "[0 0]");
	});
}

section("Element pointers");

test("whole-element stores keep element pointers valid", async () => {
	const src = `package main

import "fmt"

type S struct{ A int }
type T struct{ V int }

func first[X any](xs []X) *X { return &xs[0] }

func main() {
	xs := []S{{1}, {2}}
	p := &xs[0]
	xs[0] = S{9}
	fmt.Println(p.A, xs[0].A)
	ys := []T{{1}}
	q := first(ys)
	q.V = 7
	fmt.Println(ys[0].V)
	arr := [2]S{{1}, {2}}
	r := &arr[1]
	arr[1] = S{8}
	fmt.Println(r.A)
}
`;
	await assertProgramOutput(src, "9 9\n7\n8\n");
});

test("erased generic element pointers follow the type argument", () => {
	const src = `package main

import "fmt"

type S struct{ A int }

func first[T any](xs []T) *T { return &xs[0] }
func set[T any](p *T, v T)   { *p = v }

func main() {
	a, b := &S{1}, &S{2}
	ps := []*S{a}
	set(first(ps), b)
	fmt.Println(a.A, b.A, ps[0].A)
	ms := []map[string]int{{"x": 1}}
	set(first(ms), map[string]int{"y": 2})
	fmt.Println(ms[0]["x"], ms[0]["y"])
	as := []any{S{1}}
	set(first(as), any(5))
	fmt.Println(as[0])
	vs := []S{{1}}
	set(first(vs), S{4})
	first(vs).A++
	fmt.Println(vs[0].A)
}
`;
	const { js, errors } = compile(src, { target: "both" });
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1 2 2\n0 2\n5\n5");
});

test("tuple assignment through type-parameter pointers swaps values", () => {
	const src = `package main

import "fmt"

type S struct{ A int }

func swap[T any](a, b *T) { *a, *b = *b, *a }

func main() {
	x, y := 1, 2
	swap[int](&x, &y)
	fmt.Println(x, y)
	s, t := S{1}, S{2}
	swap[S](&s, &t)
	fmt.Println(s, t)
	ps, pt := &S{1}, &S{2}
	swap[*S](&ps, &pt)
	fmt.Println(ps.A, pt.A)
	m, n := map[string]int{"a": 1}, map[string]int{"b": 2}
	swap[map[string]int](&m, &n)
	fmt.Println(m["b"], n["a"])
	var i, j any = 1, "z"
	swap[any](&i, &j)
	fmt.Println(i, j)
}
`;
	for (const target of ["js", "both"]) {
		const { js, errors } = compile(src, { target });
		assertEqual(errors.length, 0);
		assertEqual(runJs(js), "2 1\n{2} {1}\n2 1\n2 1\nz 1");
	}
});

test("op-assign and inc/dec through type-parameter pointers", () => {
	const src = `package main

import "fmt"

type Num interface{ ~int | ~int64 }

func add[T ~int](a *T) { *a += 5 }
func inc[T ~int](a *T) { *a++ }
func adj[T Num](a, b *T) {
	*a += *b
	*b -= 1
}

func main() {
	x := 1
	add[int](&x)
	fmt.Println(x)
	inc[int](&x)
	fmt.Println(x)
	p, q := 1, 10
	adj[int](&p, &q)
	fmt.Println(p, q)
}
`;
	for (const target of ["js", "both"]) {
		const { js, errors } = compile(src, { target });
		assertEqual(errors.length, 0);
		assertEqual(runJs(js), "6\n7\n11 9");
	}
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
