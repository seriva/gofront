// GoFront test suite — Phase 4: Struct pointer unboxing and positional constructors

import {
	assert,
	assertEqual,
	compile,
	runJs,
	section,
	test,
} from "../helpers.js";

section("Struct Positional Constructors");

test("Point{X: 1, Y: 2} emits positional constructor new Point(1, 2)", () => {
	const { js, errors } = compile(`package main
type Point struct {
	X int
	Y int
}
func main() {
	p := Point{X: 1, Y: 2}
	println(p.X, p.Y)
}`);
	assertEqual(errors.length, 0);
	assert(
		js.includes("new Point(1, 2)"),
		`expected 'new Point(1, 2)' in generated code, got:\n${js}`,
	);
	assert(
		!js.includes("new Point({"),
		`expected no options object in Point instantiation, got:\n${js}`,
	);
	assertEqual(runJs(js), "1 2");
});

test("Point{Y: 2} emits new Point(0, 2) with precomputed zero values", () => {
	const { js, errors } = compile(`package main
type Point struct {
	X int
	Y int
}
func main() {
	p := Point{Y: 2}
	println(p.X, p.Y)
}`);
	assertEqual(errors.length, 0);
	assert(
		js.includes("new Point(0, 2)"),
		`expected 'new Point(0, 2)' in generated code, got:\n${js}`,
	);
	assertEqual(runJs(js), "0 2");
});

test("Point{X: 1} emits new Point(1) omitting trailing zero value", () => {
	const { js, errors } = compile(`package main
type Point struct {
	X int
	Y int
}
func main() {
	p := Point{X: 1}
	println(p.X, p.Y)
}`);
	assertEqual(errors.length, 0);
	assert(
		js.includes("new Point(1)"),
		`expected 'new Point(1)' in generated code, got:\n${js}`,
	);
	assertEqual(runJs(js), "1 0");
});

test("Point{} emits new Point() without arguments", () => {
	const { js, errors } = compile(`package main
type Point struct {
	X int
	Y int
}
func main() {
	p := Point{}
	println(p.X, p.Y)
}`);
	assertEqual(errors.length, 0);
	assert(
		js.includes("new Point()"),
		`expected 'new Point()' in generated code, got:\n${js}`,
	);
	assertEqual(runJs(js), "0 0");
});

test("Point{1, 2} positional literal compiles to new Point(1, 2)", () => {
	const { js, errors } = compile(`package main
type Point struct {
	X int
	Y int
}
func main() {
	p := Point{10, 20}
	println(p.X, p.Y)
}`);
	assertEqual(errors.length, 0);
	assert(
		js.includes("new Point(10, 20)"),
		`expected 'new Point(10, 20)' in generated code, got:\n${js}`,
	);
	assertEqual(runJs(js), "10 20");
});

section("Struct Pointer Unboxing (&s -> s)");

test("struct pointers &point do not emit { value: point }", () => {
	const { js, errors } = compile(`package main
type Point struct {
	X int
	Y int
}
func main() {
	p := Point{X: 1, Y: 2}
	ptr := &p
	println(ptr.X, ptr.Y)
}`);
	assertEqual(errors.length, 0);
	assert(
		!js.includes("{ value: p }"),
		`expected no '{ value: p }' boxing, got:\n${js}`,
	);
	assert(
		js.includes("let ptr = p;"),
		`expected 'let ptr = p;' in generated code, got:\n${js}`,
	);
	assertEqual(runJs(js), "1 2");
});

test("field access through struct pointers ptr.X compiles to ptr.X directly", () => {
	const { js, errors } = compile(`package main
type Point struct {
	X int
	Y int
}
func main() {
	p := Point{X: 1, Y: 2}
	ptr := &p
	ptr.X = 42
	println(p.X)
}`);
	assertEqual(errors.length, 0);
	assert(
		js.includes("ptr.X = 42;"),
		`expected direct 'ptr.X = 42;' without .value, got:\n${js}`,
	);
	assert(
		!js.includes("ptr.value.X"),
		`expected no 'ptr.value.X' in generated code, got:\n${js}`,
	);
	assertEqual(runJs(js), "42");
});

test("composite literal address &Point{X: 1, Y: 2} emits new Point(1, 2) directly", () => {
	const { js, errors } = compile(`package main
type Point struct {
	X int
	Y int
}
func main() {
	ptr := &Point{X: 1, Y: 2}
	println(ptr.X, ptr.Y)
}`);
	assertEqual(errors.length, 0);
	assert(
		!js.includes("{ value: new Point"),
		`expected no '{ value: new Point }' boxing, got:\n${js}`,
	);
	assert(
		js.includes("let ptr = new Point(1, 2);"),
		`expected direct 'let ptr = new Point(1, 2);', got:\n${js}`,
	);
	assertEqual(runJs(js), "1 2");
});

test("new(Point) emits new Point() directly", () => {
	const { js, errors } = compile(`package main
type Point struct {
	X int
	Y int
}
func main() {
	ptr := new(Point)
	ptr.X = 99
	println(ptr.X, ptr.Y)
}`);
	assertEqual(errors.length, 0);
	assert(
		!js.includes("{ value: new Point"),
		`expected no '{ value: new Point }' boxing, got:\n${js}`,
	);
	assert(
		js.includes("new Point()"),
		`expected 'new Point()' in generated code, got:\n${js}`,
	);
	assertEqual(runJs(js), "99 0");
});

test("out-parameter scratch instance pattern works with 0 wrapper allocations", () => {
	const { js, errors } = compile(`package main
type Vec3 struct {
	X float64
	Y float64
	Z float64
}
type Transform struct {
	PosX float64
	PosY float64
	PosZ float64
}
func (t *Transform) PointToLocal(world *Vec3, out *Vec3) *Vec3 {
	out.X = world.X - t.PosX
	out.Y = world.Y - t.PosY
	out.Z = world.Z - t.PosZ
	return out
}
func main() {
	t := Transform{PosX: 10, PosY: 20, PosZ: 30}
	world := Vec3{X: 15, Y: 25, Z: 35}
	scratch := Vec3{}
	res := t.PointToLocal(&world, &scratch)
	println(res.X, res.Y, res.Z)
	println(scratch.X, scratch.Y, scratch.Z)
}`);
	assertEqual(errors.length, 0);
	assert(!js.includes("{ value: world }"));
	assert(!js.includes("{ value: scratch }"));
	assert(js.includes("t.PointToLocal(world, scratch);"));
	assertEqual(runJs(js), "5 5 5\n5 5 5");
});

test("*ptr = other dereference assignment copies fields in place", () => {
	const { js, errors } = compile(`package main
type Point struct {
	X int
	Y int
}
func main() {
	p1 := Point{X: 1, Y: 2}
	p2 := Point{X: 100, Y: 200}
	ptr := &p1
	*ptr = p2
	println(p1.X, p1.Y)
}`);
	assertEqual(errors.length, 0);
	assert(
		js.includes("Object.assign(ptr, p2);"),
		`expected Object.assign(ptr, p2); in generated code, got:\n${js}`,
	);
	assertEqual(runJs(js), "100 200");
});

test("embedded struct initialized positionally and promotes methods", () => {
	const { js, errors } = compile(`package main
type Base struct {
	ID int
}
func (b *Base) GetID() int {
	return b.ID
}
type Item struct {
	Base
	Name string
}
func main() {
	it := Item{Base: Base{ID: 42}, Name: "widget"}
	ptr := &it
	println(ptr.GetID(), ptr.Name)
}`);
	assertEqual(errors.length, 0);
	assert(!js.includes("{ value: it }"));
	assertEqual(runJs(js), "42 widget");
});

test("struct with map as first field initializes correctly and does not trigger options bag heuristic", () => {
	const { js, errors } = compile(`package main
type Config struct {
	Data map[string]string
}
func main() {
	c := Config{Data: map[string]string{"key": "value"}}
	println(c.Data["key"])
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "value");
});
