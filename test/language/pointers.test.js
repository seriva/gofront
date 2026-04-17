import {
	assertContains,
	assertEqual,
	assertErrorContains,
	compile,
	runJs,
	section,
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
