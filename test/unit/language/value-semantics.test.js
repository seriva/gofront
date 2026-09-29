// GoFront test suite — Go value semantics for structs/arrays and T vs *T in interfaces

import {
	assert,
	assertEqual,
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
