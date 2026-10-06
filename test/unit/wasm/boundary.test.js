// test/unit/wasm/boundary.test.js
// Phase 5a/5b: JS <-> WASM boundary (values, slices, handles) and
// Phase 5c: single app.wasm linking through the compiler pipeline.

import {
	assert,
	assertEqual,
	assertThrows,
	compileHybridProject,
	section,
	test,
} from "../helpers.js";

const MATHX_BOTH = `//gofront:target both
package mathx

type Vec3 struct {
	X float64
	Y float64
	Z float64
}

func (v Vec3) Add(o Vec3) Vec3 {
	return Vec3{v.X + o.X, v.Y + o.Y, v.Z + o.Z}
}

func Dot(a, b Vec3) float64 {
	return a.X*b.X + a.Y*b.Y + a.Z*b.Z
}
`;

const PHYSICS_WASM = `//gofront:target wasm
package physics

import "../mathx"

const Gravity = 9.81
const MaxBodies = 64

type Body struct {
	Pos  mathx.Vec3
	Vel  mathx.Vec3
	Mass float64
}

func NewBody(pos mathx.Vec3, mass float64) *Body {
	return &Body{Pos: pos, Mass: mass}
}

func (b *Body) Step(dt float64) {
	b.Pos.X += b.Vel.X * dt
	b.Pos.Y += b.Vel.Y * dt
	b.Pos.Z += b.Vel.Z * dt
}

func (b *Body) Kick(v mathx.Vec3) {
	b.Vel = b.Vel.Add(v)
}

func (b Body) Speed2() float64 {
	return mathx.Dot(b.Vel, b.Vel)
}

func Energy(b *Body) float64 {
	return 0.5 * b.Mass * mathx.Dot(b.Vel, b.Vel)
}

func Translate(v *mathx.Vec3, d mathx.Vec3) {
	v.X += d.X
	v.Y += d.Y
	v.Z += d.Z
}

func Same(a, b *Body) bool {
	return a == b
}
`;

section("WASM Boundary — hybrid project linking (5c)");

test("hybrid project links one app.wasm and splices the facade into app.js", async () => {
	const res = await compileHybridProject({
		"mathx/vec.go": MATHX_BOTH,
		"physics/body.go": PHYSICS_WASM,
		"main.go": `package main

import (
	"./mathx"
	"./physics"
)

func main() {
	b := physics.NewBody(mathx.Vec3{X: 1}, 2)
	b.Kick(mathx.Vec3{X: 3, Y: 4, Z: 0})
	b.Step(0.5)
	println(b.Pos.X, b.Pos.Y, physics.Energy(b))
	v := mathx.Vec3{X: 1, Y: 1, Z: 1}
	physics.Translate(&v, mathx.Vec3{X: 1, Y: 2, Z: 3})
	println(v.X, v.Y, v.Z)
}
`,
	});
	assert(res.wasm instanceof Uint8Array, "expected linked wasm bytes");
	assert(res.wasm.length > 0, "wasm should not be empty");
	assert(!res.js.includes("__GOFRONT_WASM_UNIT"), "marker must be replaced");
	assert(res.js.includes("await __gfw_load("), "facade must load app.wasm");
	assertEqual(res.lines.join("\n"), "2.5 2 25\n2 3 4");
});

test("JS-only project emits no wasm", async () => {
	const res = await compileHybridProject({
		"main.go": `package main

func main() { println("plain") }
`,
	});
	assertEqual(res.wasm, null);
	assertEqual(res.lines.join("\n"), "plain");
});

test("both-only project emits no wasm (JS copy is used)", async () => {
	const res = await compileHybridProject({
		"mathx/vec.go": MATHX_BOTH,
		"main.go": `package main

import "./mathx"

func main() { println(mathx.Dot(mathx.Vec3{X: 1, Y: 2}, mathx.Vec3{X: 3, Y: 4})) }
`,
	});
	assertEqual(res.wasm, null);
	assertEqual(res.lines.join("\n"), "11");
});

section("WASM Boundary v1 — primitives (5a)");

const PRIMS_WASM = `//gofront:target wasm
package prims

func AddInt(a, b int) int { return a + b }
func AddI32(a, b int32) int32 { return a + b }
func Negate(b bool) bool { return !b }
func Half(f float64) float64 { return f / 2 }
func HalfF32(f float32) float32 { return f / 2 }
func Greet(name string) string { return "hi " + name }
func Byte(b byte) byte { return b + 1 }
func Big() int64 { return 1 << 53 }
func Divmod(a, b int) (int, int) { return a / b, a % b }
func Fail() { panic("kaboom") }
func Echo(v any) any { return v }
`;

test("primitives round-trip and match JS semantics", async () => {
	const res = await compileHybridProject(
		{
			"prims/prims.go": PRIMS_WASM,
			"main.go": `package main

import "./prims"

func main() {
	println(prims.AddInt(2, 3), prims.Negate(true), prims.Half(5), prims.Greet("bob"))
	println(prims.AddI32(2147483647, 1), prims.Byte(255), prims.HalfF32(1))
	q, r := prims.Divmod(7, 2)
	println(q, r)
}
`,
		},
		{
			exports: ["AddInt", "Negate", "Half", "Greet", "Byte", "Divmod", "Echo"],
		},
	);
	assertEqual(res.lines[0], "5 false 2.5 hi bob");
	assertEqual(res.lines[1], "-2147483648 0 0.5");
	assertEqual(res.lines[2], "3 1");
	// Direct facade calls: Numbers in, Numbers out (no BigInt leaks).
	assertEqual(res.mod.AddInt(40, 2), 42);
	assertEqual(typeof res.mod.AddInt(1, 1), "number");
	assertEqual(res.mod.Negate(false), true);
	assertEqual(res.mod.Greet("x"), "hi x");
	assertEqual(res.mod.Byte(1), 2);
	const [q, r] = res.mod.Divmod(9, 4);
	assertEqual(q, 2);
	assertEqual(r, 1);
	assertEqual(res.mod.Echo("same"), "same");
});

test("int64 beyond the safe JS range throws RangeError on the way out", async () => {
	const res = await compileHybridProject(
		{
			"prims/prims.go": PRIMS_WASM,
			"main.go": `package main

import "./prims"

func main() { println(prims.AddInt(1, 1)) }
`,
		},
		{ exports: ["Big"] },
	);
	assertThrows(() => res.mod.Big(), "exceeds the safe JS integer range");
});

test("wasm panic surfaces as a JS Error with the Go message", async () => {
	const res = await compileHybridProject(
		{
			"prims/prims.go": PRIMS_WASM,
			"main.go": `package main

import "./prims"

func main() { println(prims.AddInt(1, 1)) }
`,
		},
		{ exports: ["Fail"] },
	);
	let caught = null;
	try {
		res.mod.Fail();
	} catch (e) {
		caught = e;
	}
	assert(caught instanceof Error, "expected a plain Error");
	assertEqual(caught.message, "kaboom");
});

section("WASM Boundary v1 — struct values from both packages (5a)");

test("both-struct values cross by copy; *T params write back", async () => {
	const res = await compileHybridProject(
		{
			"mathx/vec.go": MATHX_BOTH,
			"physics/body.go": PHYSICS_WASM,
			"main.go": `package main

import (
	"./mathx"
	"./physics"
)

func main() {
	v := mathx.Vec3{X: 1, Y: 1, Z: 1}
	physics.Translate(&v, mathx.Vec3{X: 1, Y: 2, Z: 3})
	println(v.X, v.Y, v.Z)
}
`,
		},
		{ exports: ["Vec3", "Translate", "Dot"] },
	);
	assertEqual(res.lines[0], "2 3 4");
	// The both-struct JS class is the plain JS copy, not a handle.
	const a = new res.mod.Vec3(1, 2, 3);
	assertEqual(a.__ref, undefined);
	res.mod.Translate(a, new res.mod.Vec3(10, 20, 30));
	assertEqual(a.X, 11);
	assertEqual(a.Y, 22);
	assertEqual(a.Z, 33);
	// Dot is a both function: JS copy answers directly.
	assertEqual(res.mod.Dot(a, new res.mod.Vec3(1, 0, 0)), 11);
});

test("struct passing across the boundary matches JS-only results", async () => {
	const files = {
		"mathx/vec.go": MATHX_BOTH,
		"main.go": `package main

import (
	"./mathx"
	"./geo"
)

func main() {
	a := mathx.Vec3{X: 1, Y: 2, Z: 3}
	b := mathx.Vec3{X: -4, Y: 0.5, Z: 2}
	c := geo.Mix(a, b, 0.25)
	println(c.X, c.Y, c.Z, geo.Len2(c))
}
`,
	};
	const GEO = `package geo

import "../mathx"

func Mix(a, b mathx.Vec3, t float64) mathx.Vec3 {
	return mathx.Vec3{a.X + (b.X-a.X)*t, a.Y + (b.Y-a.Y)*t, a.Z + (b.Z-a.Z)*t}
}

func Len2(v mathx.Vec3) float64 { return mathx.Dot(v, v) }
`;
	const jsOnly = await compileHybridProject({ ...files, "geo/geo.go": GEO });
	const hybrid = await compileHybridProject({
		...files,
		"geo/geo.go": `//gofront:target wasm\n${GEO}`,
	});
	assertEqual(jsOnly.wasm, null);
	assert(hybrid.wasm, "hybrid build must link wasm");
	assertEqual(hybrid.lines.join("\n"), jsOnly.lines.join("\n"));
});

section("WASM Boundary v1 — opaque handles (5b)");

test("wasm-package structs are opaque handles with stable identity", async () => {
	const res = await compileHybridProject(
		{
			"mathx/vec.go": MATHX_BOTH,
			"physics/body.go": PHYSICS_WASM,
			"main.go": `package main

import (
	"./mathx"
	"./physics"
)

var World = physics.NewBody(mathx.Vec3{}, 1)

func main() {
	w := World
	println(w == World, physics.Same(w, World))
}
`,
		},
		{ exports: ["Body", "NewBody", "Same", "Energy", "Vec3"] },
	);
	assertEqual(res.lines[0], "true true");
	const b = res.mod.NewBody(new res.mod.Vec3(1, 2, 3), 4);
	assert(b instanceof res.mod.Body, "NewBody returns a Body handle");
	assert(b.__ref !== undefined, "handle wraps a wasm ref");
	// Same wasm ref returned again resolves to the same JS wrapper.
	assertEqual(res.mod.Body.__wrap(b.__ref), b);
	assertEqual(res.mod.Same(b, b), true);
	assertEqual(res.mod.Same(b, res.mod.NewBody(new res.mod.Vec3(), 1)), false);
	// Field access goes through accessors; nested both-struct copies out.
	assertEqual(b.Mass, 4);
	assertEqual(b.Pos.Z, 3);
	b.Mass = 10;
	b.Kick(new res.mod.Vec3(1, 0, 0));
	assertEqual(res.mod.Energy(b), 5);
	assertEqual(b.Speed2(), 1);
	// `new Body(...)` from JS constructs inside wasm.
	const c = new res.mod.Body(new res.mod.Vec3(0, 0, 1), new res.mod.Vec3(), 2);
	assertEqual(c.Pos.Z, 1);
	assertEqual(c.Mass, 2);
	// Constructor also accepts the positional defaults.
	const d = new res.mod.Body();
	assertEqual(d.Mass, 0);
});

test("aggregate fields read through a handle are live views into wasm", async () => {
	const res = await compileHybridProject(
		{
			"mathx/vec.go": MATHX_BOTH,
			"physics/body.go": PHYSICS_WASM,
			"bag/bag.go": `//gofront:target wasm
package bag

type Bag struct {
	Tags []int
	Grid [2]int
}

func New() *Bag { return &Bag{Tags: []int{1, 2}, Grid: [2]int{3, 4}} }
func (b *Bag) Sum() int { return b.Tags[0] + b.Tags[1] + b.Grid[0] + b.Grid[1] }
`,
			"main.go": `package main

import (
	"./bag"
	"./mathx"
	"./physics"
)

func main() {
	b := physics.NewBody(mathx.Vec3{}, 1)
	b.Pos.X = 5
	b.Pos.X += 1
	println(b.Pos.X)
	g := bag.New()
	g.Tags[0] = 9
	g.Grid[1] = 40
	println(g.Sum())
}
`,
		},
		{ exports: ["NewBody", "Vec3", "New"] },
	);
	// Go code inside wasm packages already behaves like Go.
	assertEqual(res.lines.join("\n"), "6\n54");
	// The JS side must observe the same semantics through a handle.
	const b = res.mod.NewBody(new res.mod.Vec3(), 1);
	b.Pos.X = 5;
	b.Pos.X += 1;
	assertEqual(b.Pos.X, 6);
	assert(b.Pos instanceof res.mod.Vec3, "nested view keeps the JS class");
	const g = res.mod.New();
	g.Tags[0] = 9;
	g.Grid[1] = 40;
	assertEqual(g.Sum(), 54);
	assertEqual(g.Tags.length, 2);
	assertEqual(JSON.stringify([...g.Tags]), "[9,2]");
	assertEqual(JSON.stringify(Array.from(g.Grid)), "[3,40]");
});

test("wasm-package consts are exposed to JS", async () => {
	const res = await compileHybridProject(
		{
			"mathx/vec.go": MATHX_BOTH,
			"physics/body.go": PHYSICS_WASM,
			"main.go": `package main

import "./physics"

func main() { println(physics.Gravity, physics.MaxBodies) }
`,
		},
		{ exports: ["Gravity", "MaxBodies"] },
	);
	assertEqual(res.lines[0], "9.81 64");
	assertEqual(res.mod.Gravity, 9.81);
	assertEqual(res.mod.MaxBodies, 64);
});

section("WASM Boundary v1 — slices, arrays and callbacks (5b)");

const COLL_WASM = `//gofront:target wasm
package coll

type Pt struct {
	X int
	Y int
}

func Sum(xs []int) int {
	t := 0
	for _, x := range xs {
		t += x
	}
	return t
}

func Doubled(xs []float64) []float64 {
	out := make([]float64, len(xs))
	for i, x := range xs {
		out[i] = x * 2
	}
	return out
}

func Join(parts []string) string {
	s := ""
	for _, p := range parts {
		s += p
	}
	return s
}

func Flags() []bool { return []bool{true, false, true} }

func Centroid(pts []*Pt) Pt {
	c := Pt{}
	for _, p := range pts {
		c.X += p.X
		c.Y += p.Y
	}
	return c
}

func Fill(n int) [3]int { return [3]int{n, n, n} }

func Apply(f func(int) int, x int) int { return f(x) }

func Each(xs []int, f func(int)) {
	for _, x := range xs {
		f(x)
	}
}

func Adder(n int) func(int) int {
	return func(x int) int { return x + n }
}
`;

test("slices copy element-wise in both directions", async () => {
	const res = await compileHybridProject(
		{
			"coll/coll.go": COLL_WASM,
			"main.go": `package main

import "./coll"

func main() {
	println(coll.Sum([]int{1, 2, 3}), coll.Join([]string{"a", "b"}))
	d := coll.Doubled([]float64{1.5, 2})
	println(len(d), d[0], d[1])
	f := coll.Flags()
	println(f[0], f[1], f[2])
}
`,
		},
		{ exports: ["Sum", "Doubled", "Join", "Flags", "Fill", "Centroid", "Pt"] },
	);
	assertEqual(res.lines.join("\n"), "6 ab\n2 3 4\ntrue false true");
	assertEqual(res.mod.Sum([10, 20, 12]), 42);
	assertEqual(res.mod.Sum(new Int32Array([1, 2, 3])), 6);
	assertEqual(res.mod.Sum(null), 0);
	assertEqual(
		JSON.stringify(res.mod.Doubled(new Float64Array([1, 2]))),
		"[2,4]",
	);
	assertEqual(JSON.stringify(res.mod.Fill(7)), "[7,7,7]");
	const c = res.mod.Centroid([new res.mod.Pt(1, 2), new res.mod.Pt(3, 4)]);
	assertEqual(c.X, 4);
	assertEqual(c.Y, 6);
});

test("func values cross as callbacks in both directions", async () => {
	const res = await compileHybridProject(
		{
			"coll/coll.go": COLL_WASM,
			"main.go": `package main

import "./coll"

func main() {
	println(coll.Apply(func(x int) int { return x * 10 }, 4))
	add := coll.Adder(5)
	println(add(1), add(2))
	coll.Each([]int{1, 2}, func(x int) { println("got", x) })
}
`,
		},
		{ exports: ["Apply", "Adder", "Each"] },
	);
	assertEqual(res.lines.join("\n"), "40\n6 7\ngot 1\ngot 2");
	assertEqual(
		res.mod.Apply((x) => x + 1, 41),
		42,
	);
	const seen = [];
	res.mod.Each([3, 4], (x) => seen.push(x));
	assertEqual(seen.join(","), "3,4");
	const add = res.mod.Adder(100);
	assertEqual(add(1), 101);
});

section("WASM Boundary v1 — unsupported types are rejected (planned)");

async function expectBoundaryError(wasmSrc, what) {
	await expectCompileError(
		{
			"pkg/pkg.go": `//gofront:target wasm\npackage pkg\n${wasmSrc}`,
			"main.go": `package main

import "./pkg"

func main() { pkg.Touch() }
`,
		},
		`${what} is not yet supported across the wasm boundary (planned)`,
	);
}

async function expectCompileError(files, expected) {
	let msg = "";
	try {
		await compileHybridProject(files);
	} catch (e) {
		msg = e.message;
	}
	assert(
		msg.includes(expected),
		`expected error containing ${JSON.stringify(expected)}\ngot: ${JSON.stringify(msg)}`,
	);
}

test("map parameters are rejected at the boundary", () =>
	expectBoundaryError(
		`func Touch() {}
func Count(m map[string]int) int { return len(m) }`,
		"map",
	));

test("error returns are rejected at the boundary", () =>
	expectBoundaryError(
		`func Touch() {}
func Try() error { return nil }`,
		"error",
	));

test("non-empty interface parameters are rejected at the boundary", () =>
	expectBoundaryError(
		`type Shape interface { Area() float64 }
func Touch() {}
func Measure(s Shape) float64 { return s.Area() }`,
		"interface 'Shape'",
	));

test("exported struct fields are validated too", () =>
	expectBoundaryError(
		`type Cfg struct { Opts map[string]int }
func Touch() {}`,
		"map",
	));

test("exported non-literal consts are rejected at the boundary", () =>
	expectBoundaryError(
		`const Base = 10
const Derived = Base * 2
func Touch() {}`,
		"pkg.Derived: a constant with a non-literal value",
	));

test("referencing a non-literal const inside wasm reports a planned error", () =>
	expectCompileError(
		{
			"pkg/pkg.go": `//gofront:target wasm
package pkg

const base = 10
const derived = base * 2

func Touch() int { return derived }
`,
			"main.go": `package main

import "./pkg"

func main() { println(pkg.Touch()) }
`,
		},
		"constant 'derived' has a non-literal value, which the wasm backend does not support yet (planned)",
	));

section("WASM Boundary v1 — linking diagnostics (5c)");

test("top-level name collisions between linked wasm packages are an error", () =>
	expectCompileError(
		{
			"a/a.go": `//gofront:target wasm
package a

func helper() int { return 1 }
func A() int { return helper() }
`,
			"b/b.go": `//gofront:target wasm
package b

func helper() int { return 2 }
func B() int { return helper() }
`,
			"main.go": `package main

import (
	"./a"
	"./b"
)

func main() { println(a.A(), b.B()) }
`,
		},
		"'helper' is declared in both 'a' and 'b'",
	));
