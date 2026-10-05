// test/unit/wasm/structs.test.js
// Tests for Phase 4a: Structs, Pointers, and Methods in WASM.

import {
	assertEqual,
	compileHybrid,
	compileWasm,
	runWasm,
	section,
	test,
} from "../helpers.js";

section("WASM Structs — mathx.Vec3 Operations & Methods");

test("mathx.Vec3 vector math, methods, and chaining parity", () => {
	const src = `
package main

import "math"

type Vec3 struct {
	X float32
	Y float32
	Z float32
}

func NewVec3(x, y, z float32) *Vec3 {
	return &Vec3{X: x, Y: y, Z: z}
}

func (out *Vec3) Set(x, y, z float32) *Vec3 {
	out.X = x
	out.Y = y
	out.Z = z
	return out
}

func (out *Vec3) Add(a, b *Vec3) *Vec3 {
	out.X = a.X + b.X
	out.Y = a.Y + b.Y
	out.Z = a.Z + b.Z
	return out
}

func (out *Vec3) Scale(s float32) *Vec3 {
	out.X = out.X * s
	out.Y = out.Y * s
	out.Z = out.Z * s
	return out
}

func (out *Vec3) Dot(b *Vec3) float32 {
	return out.X*b.X + out.Y*b.Y + out.Z*b.Z
}

func (out *Vec3) Length() float32 {
	return float32(math.Sqrt(float64(out.X*out.X + out.Y*out.Y + out.Z*out.Z)))
}

func Main() float32 {
	v1 := NewVec3(1.0, 2.0, 3.0)
	v2 := NewVec3(4.0, 5.0, 6.0)
	var v3 Vec3
	v3.Add(v1, v2) // (5, 7, 9)
	v3.Scale(2.0)  // (10, 14, 18) -> sum = 42

	dot := v1.Dot(v2) // 1*4 + 2*5 + 3*6 = 32
	l := NewVec3(3.0, 4.0, 0.0).Length() // 5.0

	// Test chaining
	var v4 Vec3
	v4.Set(1.0, 1.0, 1.0).Scale(10.0) // (10, 10, 10) -> sum = 30

	return (v3.X + v3.Y + v3.Z) + dot + l + (v4.X + v4.Y + v4.Z) // 42 + 32 + 5 + 30 = 109
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 109);
	assertEqual(res.jsRes, 109);
});

section("WASM Structs — Pointer vs Value Semantics");

test("Struct assignment clones values, preserving immutability of source", () => {
	const src = `
package main

type Point struct {
	X int
	Y int
}

func Main() int {
	p1 := Point{X: 10, Y: 20}
	p2 := p1
	p2.X = 999
	p2.Y = 888

	// p1 must not have been mutated
	return p1.X + p1.Y
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 30n);
	assertEqual(res.jsRes, 30);
});

test("Pass-by-value vs pass-by-pointer in functions", () => {
	const src = `
package main

type Point struct {
	X int
	Y int
}

func MutateByVal(p Point) {
	p.X = 100
}

func MutateByPtr(p *Point) {
	p.X = 200
}

func Main() int {
	val := Point{X: 10, Y: 20}
	MutateByVal(val)
	afterVal := val.X // 10

	ptr := &Point{X: 10, Y: 20}
	MutateByPtr(ptr)
	afterPtr := ptr.X // 200

	return afterVal + afterPtr
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 210n);
	assertEqual(res.jsRes, 210);
});

test("Dereferencing struct pointer creates a clone value", () => {
	const src = `
package main

type Point struct {
	X int
	Y int
}

func Main() int {
	ptr := &Point{X: 10, Y: 20}
	val := *ptr
	val.X = 500

	return ptr.X + val.X // 10 + 500 = 510
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 510n);
	assertEqual(res.jsRes, 510);
});

section("WASM Structs — Rec Groups & Recursive Structs");

test("Recursive linked list struct with traversal loop and nil checks", () => {
	const src = `
package main

type Node struct {
	Val  int
	Next *Node
}

func Main() int {
	n3 := &Node{Val: 30, Next: nil}
	n2 := &Node{Val: 20, Next: n3}
	n1 := &Node{Val: 10, Next: n2}

	sum := 0
	curr := n1
	for curr != nil {
		sum = sum + curr.Val
		curr = curr.Next
	}
	return sum
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 60n);
	assertEqual(res.jsRes, 60);
});

test("Mutually recursive structs in rec group", () => {
	const src = `
package main

type Parent struct {
	Id    int
	Child *Child
}

type Child struct {
	Id     int
	Parent *Parent
}

func Main() int {
	p := &Parent{Id: 1, Child: nil}
	c := &Child{Id: 2, Parent: p}
	p.Child = c

	return p.Id + p.Child.Id + c.Parent.Id
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 4n);
	assertEqual(res.jsRes, 4);
});

section("WASM Structs — Embedded Structs & Method Promotion");

test("Embedded struct fields and promoted method calls", () => {
	const src = `
package main

type Base struct {
	Val int
}

func (b *Base) GetVal() int {
	return b.Val
}

type Derived struct {
	Base
	Extra int
}

func Main() int {
	d := &Derived{Base: Base{Val: 42}, Extra: 10}
	mVal := d.GetVal() // promoted method: 42
	fVal := d.Val      // promoted field: 42
	eVal := d.Extra    // direct field: 10

	d.Val = 100 // mutate promoted field
	afterMut := d.GetVal() // 100

	return mVal + fVal + eVal + afterMut // 42 + 42 + 10 + 100 = 194
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 194n);
	assertEqual(res.jsRes, 194);
});

section("WASM Structs — Nil Pointer Trapping");

test("Dereferencing nil struct pointer traps with runtime panic", () => {
	const src = `
package main

type Node struct {
	Val int
}

func Main() int {
	var n *Node
	return n.Val
}
`;

	const { wasm, stringTable } = compileWasm(src);
	let threw = false;
	try {
		const { exports } = runWasm(wasm, { stringTable });
		exports.Main();
	} catch (e) {
		threw = true;
		assertEqual(
			e.message,
			"runtime error: invalid memory address or nil pointer dereference",
		);
	}
	assertEqual(threw, true);
});
