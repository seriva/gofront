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

test("handle methods with int params/results take Numbers, not BigInts", async () => {
	const res = await compileHybridProject(
		{
			"counter/counter.go": `//gofront:target wasm
package counter

type Counter struct{ N int }

func New(n int) *Counter { return &Counter{N: n} }
func (c *Counter) Add(d int) int { c.N += d; return c.N }
func (c *Counter) Set(i int, v float32) float32 { c.N = i; return v * 2 }
`,
			"main.go": `package main

import "./counter"

func main() { println(counter.New(1).Add(2)) }
`,
		},
		{ exports: ["New"] },
	);
	assertEqual(res.lines[0], "3");
	const c = res.mod.New(5);
	assertEqual(c.Add(7), 12);
	assertEqual(typeof c.Add(0), "number");
	assertEqual(c.Set(3, 1.5), 3);
	assertEqual(c.N, 3);
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

test("anonymous non-empty interface parameters are rejected at the boundary", () =>
	expectBoundaryError(
		`func Touch() {}
func Measure(s interface{ Area() float64 }) float64 { return s.Area() }`,
		"anonymous interface",
	));

test("interface methods with unsupported signatures are rejected at the boundary", () =>
	expectBoundaryError(
		`type Shape interface { Tags() map[string]int }
func Touch() {}
func Measure(s Shape) int { return len(s.Tags()) }`,
		"map (in method Shape.Tags)",
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

section(
	"WASM Boundary v2 — WASM to JS closures & cached trampolines (Task H5.1)",
);

const CLOSURE_PKG_WASM = `//gofront:target wasm
package clospkg

import "../mathx"

var savedHook func(int) int

func MakeCounter() func() int {
	c := 0
	return func() int {
		c++
		return c
	}
}

func SetHook(f func(int) int) {
	savedHook = f
}

func GetHook() func(int) int {
	return savedHook
}

func ApplyHook(x int) int {
	if savedHook != nil {
		return savedHook(x)
	}
	return 0
}

func CurriedAdd(a int) func(int) func(int) int {
	return func(b int) func(int) int {
		return func(c int) int {
			return a + b + c
		}
	}
}

func DivModClosure(divisor int) func(int) (int, int) {
	return func(n int) (int, int) {
		return n / divisor, n % divisor
	}
}

func FailingClosure() func(int) int {
	return func(x int) int {
		if x < 0 {
			panic("closure negative")
		}
		return x * 2
	}
}

func GetOps() []func(int) int {
	return []func(int) int{
		func(x int) int { return x + 10 },
		func(x int) int { return x * 5 },
	}
}

type DynamicBody struct {
	Pos      mathx.Vec3
	Mass     float64
	OnBounce func(hp, hn *mathx.Vec3, speed float32)
}

func NewDynamicBody(pos mathx.Vec3, mass float64) *DynamicBody {
	return &DynamicBody{Pos: pos, Mass: mass}
}

func (b *DynamicBody) Bounce(hp, hn *mathx.Vec3, speed float32) {
	if b.OnBounce != nil {
		b.OnBounce(hp, hn, speed)
	}
}

func (b *DynamicBody) SetDefaultBounce() {
	b.OnBounce = func(hp, hn *mathx.Vec3, speed float32) {
		hp.X += float64(speed * 2)
		hn.Y += float64(speed)
	}
}
`;

test("WASM closure returned to JS is wrapped in a cached trampoline with stable identity", async () => {
	const res = await compileHybridProject(
		{
			"mathx/vec.go": MATHX_BOTH,
			"clospkg/clospkg.go": CLOSURE_PKG_WASM,
			"main.go": `package main

import "./clospkg"

func main() {
	c := clospkg.MakeCounter()
	println(c(), c())
}
`,
		},
		{
			exports: [
				"MakeCounter",
				"SetHook",
				"GetHook",
				"ApplyHook",
				"CurriedAdd",
				"DivModClosure",
				"FailingClosure",
				"GetOps",
				"DynamicBody",
				"NewDynamicBody",
			],
		},
	);
	assertEqual(res.lines.join("\n"), "1 2");

	// 1. Calling MakeCounter from JS returns a function with __ref
	const c = res.mod.MakeCounter();
	assertEqual(typeof c, "function");
	assert(c.__ref !== undefined, "trampoline carries wasm reference");
	assertEqual(c(), 1);
	assertEqual(c(), 2);
	assertEqual(c(), 3);

	// 2. Roundtripping through WASM preserves stable function identity
	res.mod.SetHook(c);
	const retrieved = res.mod.GetHook();
	assertEqual(retrieved, c);
	assertEqual(retrieved(), 4);

	// 3. Applying the hook from WASM executes the closure
	assertEqual(res.mod.ApplyHook(100), 5); // counter advances to 5
});

test("JS callbacks passed to WASM roundtrip with stable identity", async () => {
	const res = await compileHybridProject(
		{
			"mathx/vec.go": MATHX_BOTH,
			"clospkg/clospkg.go": CLOSURE_PKG_WASM,
			"main.go": `package main

import "./clospkg"

func main() { _ = clospkg.SetHook }
`,
		},
		{ exports: ["SetHook", "GetHook", "ApplyHook"] },
	);

	const myJsCb = (x) => x * 10;
	res.mod.SetHook(myJsCb);

	// Reading back the hook returns the exact same JS function reference
	const got = res.mod.GetHook();
	assertEqual(got, myJsCb);

	// WASM calling the hook runs the JS callback
	assertEqual(res.mod.ApplyHook(7), 70);
});

test("WASM struct field closures (DynamicBody.OnBounce style) with live calls & copy-in/copy-out writeback", async () => {
	const res = await compileHybridProject(
		{
			"mathx/vec.go": MATHX_BOTH,
			"clospkg/clospkg.go": CLOSURE_PKG_WASM,
			"main.go": `package main

import "./clospkg"

func main() { _ = clospkg.NewDynamicBody }
`,
		},
		{ exports: ["DynamicBody", "NewDynamicBody", "Vec3"] },
	);

	const b = res.mod.NewDynamicBody(new res.mod.Vec3(0, 0, 0), 1);
	assertEqual(b.OnBounce, null);

	// Assign JS callback to struct field
	const log = [];
	b.OnBounce = (hp, _hn, speed) => {
		log.push({ x: hp.X, speed });
		hp.X += speed * 3;
	};

	// Identity preserved on reading back
	assertEqual(typeof b.OnBounce, "function");

	// WASM invokes Bounce, callback runs and mutates *mathx.Vec3
	const hp = new res.mod.Vec3(10, 0, 0);
	const hn = new res.mod.Vec3(0, 1, 0);
	b.Bounce(hp, hn, 2);

	assertEqual(log.length, 1);
	assertEqual(log[0].x, 10);
	assertEqual(log[0].speed, 2);
	// copy-in / copy-out writeback verified
	assertEqual(hp.X, 16);

	// WASM assigns its own closure to OnBounce
	b.SetDefaultBounce();
	const bounceTramp1 = b.OnBounce;
	const bounceTramp2 = b.OnBounce;
	assertEqual(bounceTramp1, bounceTramp2); // cached trampoline stable identity
	assertEqual(typeof bounceTramp1, "function");
	assert(bounceTramp1.__ref !== undefined, "has underlying wasm ref");

	// Calling the WASM closure trampoline directly from JS
	bounceTramp1(hp, hn, 5);
	assertEqual(hp.X, 26); // 16 + 5*2 = 26
	assertEqual(hn.Y, 6); // 1 + 5 = 6

	// Transfer closure from b to b2 without double wrapping
	const b2 = res.mod.NewDynamicBody(new res.mod.Vec3(), 2);
	b2.OnBounce = bounceTramp1;
	assertEqual(b2.OnBounce, bounceTramp1); // stable identity across bodies
	b2.Bounce(hp, hn, 1);
	assertEqual(hp.X, 28); // 26 + 1*2 = 28

	// Clear callback sets to nil
	b.OnBounce = null;
	assertEqual(b.OnBounce, null);
	b.Bounce(hp, hn, 10);
	assertEqual(hp.X, 28); // unchanged since OnBounce was nil
});

test("Panic inside WASM closure called from JS propagates as Error", async () => {
	const res = await compileHybridProject(
		{
			"mathx/vec.go": MATHX_BOTH,
			"clospkg/clospkg.go": CLOSURE_PKG_WASM,
			"main.go": `package main

import "./clospkg"

func main() { _ = clospkg.FailingClosure }
`,
		},
		{ exports: ["FailingClosure"] },
	);

	const f = res.mod.FailingClosure();
	assertEqual(f(5), 10);

	let err = null;
	try {
		f(-1);
	} catch (e) {
		err = e;
	}
	assert(err instanceof Error, "expected Error from closure panic");
	assertEqual(err.message, "closure negative");
});

test("Higher-order WASM closures across boundary", async () => {
	const res = await compileHybridProject(
		{
			"mathx/vec.go": MATHX_BOTH,
			"clospkg/clospkg.go": CLOSURE_PKG_WASM,
			"main.go": `package main

import "./clospkg"

func main() { _ = clospkg.CurriedAdd }
`,
		},
		{ exports: ["CurriedAdd", "SetHook", "GetHook", "ApplyHook"] },
	);

	const add10 = res.mod.CurriedAdd(10);
	const add10_20 = add10(20);
	assertEqual(add10_20(30), 60);

	// Boundary identity preservation & round-trip of higher-order closures
	res.mod.SetHook(add10_20);
	assertEqual(res.mod.GetHook(), add10_20);
	assertEqual(res.mod.GetHook(), res.mod.GetHook());
	assertEqual(res.mod.ApplyHook(30), 60);
});

test("WASM closure returning multiple values across boundary", async () => {
	const res = await compileHybridProject(
		{
			"mathx/vec.go": MATHX_BOTH,
			"clospkg/clospkg.go": CLOSURE_PKG_WASM,
			"main.go": `package main

import "./clospkg"

func main() { _ = clospkg.DivModClosure }
`,
		},
		{ exports: ["DivModClosure"] },
	);

	const dm = res.mod.DivModClosure(10);
	const [q, r] = dm(42);
	assertEqual(q, 4);
	assertEqual(r, 2);
});

test("Slice of WASM closures crosses boundary with cached trampolines", async () => {
	const res = await compileHybridProject(
		{
			"mathx/vec.go": MATHX_BOTH,
			"clospkg/clospkg.go": CLOSURE_PKG_WASM,
			"main.go": `package main

import "./clospkg"

func main() { _ = clospkg.GetOps }
`,
		},
		{ exports: ["GetOps"] },
	);

	const ops = res.mod.GetOps();
	assertEqual(ops.length, 2);
	assertEqual(ops[0](5), 15);
	assertEqual(ops[1](5), 25);
});

test("WASM struct `from` factory builds a handle from a plain JS object with closure", async () => {
	const res = await compileHybridProject(
		{
			"mathx/vec.go": MATHX_BOTH,
			"clospkg/clospkg.go": CLOSURE_PKG_WASM,
			"main.go": `package main

import "./clospkg"

func main() { _ = clospkg.NewDynamicBody }
`,
		},
		{ exports: ["DynamicBody", "Vec3"] },
	);

	const b = res.mod.DynamicBody.from({
		Pos: new res.mod.Vec3(1, 2, 3),
		Mass: 5,
		OnBounce: (hp, _hn, s) => {
			hp.X += s;
		},
	});
	assertEqual(b.Mass, 5);
	assertEqual(b.Pos.X, 1);
	assertEqual(typeof b.OnBounce, "function");

	const hp = new res.mod.Vec3(10, 0, 0);
	const hn = new res.mod.Vec3(0, 1, 0);
	b.Bounce(hp, hn, 4);
	assertEqual(hp.X, 14);
});

test("WASM struct constructor is positional; plain objects are rejected for *T and copied for T", async () => {
	const res = await compileHybridProject(
		{
			"boxpkg/box.go": `//gofront:target wasm
package boxpkg

type Box struct {
	Val any
	N   int
}

func GetVal(b *Box) any { return b.Val }
func Bump(b *Box) { b.N++ }
func Sum(b Box) int { return b.N + 1 }
`,
			"main.go": `package main
import "./boxpkg"

func main() { _ = boxpkg.GetVal }
`,
		},
		{ exports: ["Box", "GetVal", "Bump", "Sum"] },
	);

	// A plain object as the first positional argument is the field value, never
	// a keyed initialiser.
	const payload = { Val: 42 };
	const b = new res.mod.Box(payload);
	assertEqual(b.Val, payload);
	assertEqual(res.mod.GetVal(b), payload);
	assertEqual(res.mod.Box.from({ Val: 42, N: 2 }).N, 2);

	// *T parameters require a handle: a plain object would be a silent copy.
	assertThrows(
		() => res.mod.Bump({ N: 1 }),
		"expected a Box handle for a *Box parameter",
	);
	// T (value) parameters copy a plain object field-wise.
	assertEqual(res.mod.Sum({ N: 4 }), 5);
});

section("WASM Boundary v2 — interface resolution (Task H5.2)");

const SHAPES_WASM = `//gofront:target wasm
package shapes

type Shape interface {
	Area() float64
	Scale(f float64) Shape
}

type Circle struct {
	R float64
}

func (c *Circle) Area() float64 { return 3 * c.R * c.R }
func (c *Circle) Scale(f float64) Shape { return &Circle{R: c.R * f} }

type square struct {
	s float64
}

func (q *square) Area() float64 { return q.s * q.s }
func (q *square) Scale(f float64) Shape { return &square{s: q.s * f} }

type rect struct {
	w, h float64
}

func (r rect) Area() float64          { return r.w * r.h }
func (r rect) Scale(f float64) Shape { return rect{w: r.w * f, h: r.h * f} }

type Scene struct {
	Main Shape
}

var kept Shape

func NewCircle(r float64) Shape { return &Circle{R: r} }
func NewSquare(s float64) Shape { return &square{s: s} }
func NewRect(w, h float64) Shape { return rect{w: w, h: h} }

func Keep(s Shape) { kept = s }
func Kept() Shape  { return kept }

func Measure(s Shape) float64 {
	if s == nil {
		return -1
	}
	return s.Area()
}

func All() []Shape {
	return []Shape{&Circle{R: 1}, &square{s: 2}, rect{w: 1, h: 5}}
}

func Visit(f func(s Shape) float64) float64 {
	return f(&square{s: 4})
}

func Broken() Shape { return &broken{} }

type broken struct{}

func (b *broken) Area() float64      { panic("no area") }
func (b *broken) Scale(f float64) Shape { return b }
`;

const SHAPES_EXPORTS = [
	"Circle",
	"Scene",
	"NewCircle",
	"NewSquare",
	"NewRect",
	"Keep",
	"Kept",
	"Measure",
	"All",
	"Visit",
	"Broken",
];

async function compileShapes(main = "func main() { _ = shapes.Measure }") {
	return compileHybridProject(
		{
			"shapes/shapes.go": SHAPES_WASM,
			"main.go": `package main

import "./shapes"

${main}
`,
		},
		{ exports: SHAPES_EXPORTS },
	);
}

test("exported *T held in an interface reaches JS as its handle class", async () => {
	const res = await compileShapes();
	const c = res.mod.NewCircle(2);
	assert(c instanceof res.mod.Circle, "expected Circle handle");
	assertEqual(c.R, 2);
	assertEqual(c.Area(), 12);
	assertEqual(c.__p, true);
	const big = c.Scale(2);
	assert(big instanceof res.mod.Circle, "Scale returns a Circle handle");
	assertEqual(big.Area(), 48);
	// The handle goes back in as the same wasm object.
	res.mod.Keep(c);
	assertEqual(res.mod.Kept(), c);
	c.R = 3;
	assertEqual(res.mod.Measure(c), 27);
});

test("unexported and boxed dynamic types reach JS as an interface facade", async () => {
	const res = await compileShapes();
	const q = res.mod.NewSquare(3);
	assert(!(q instanceof res.mod.Circle), "square is not a Circle");
	assertEqual(q.Area(), 9);
	assertEqual(q.Scale(2).Area(), 36);
	res.mod.Keep(q);
	assertEqual(res.mod.Kept(), q, "facade identity is stable per wasm object");
	assertEqual(res.mod.Measure(q), 9);

	const r = res.mod.NewRect(2, 3);
	assertEqual(r.Area(), 6);
	assertEqual(r.Scale(2).Area(), 24);
	assertEqual(res.mod.Measure(r), 6);
	assertEqual(res.mod.Measure(null), -1);
});

test("interfaces cross inside slices, struct fields and callbacks", async () => {
	const res = await compileShapes();
	const all = res.mod.All();
	assertEqual(all.map((s) => s.Area()).join(","), "3,4,5");
	assert(all[0] instanceof res.mod.Circle, "slice element keeps handle class");

	const scene = new res.mod.Scene();
	assertEqual(scene.Main, null);
	scene.Main = res.mod.NewSquare(5);
	assertEqual(scene.Main.Area(), 25);

	assertEqual(
		res.mod.Visit((s) => s.Area() + 1),
		17,
	);
});

test("a panic in a wasm method called through the facade is a JS Error", async () => {
	const res = await compileShapes();
	const b = res.mod.Broken();
	assertThrows(() => b.Area(), "no area");
});

test("JS-implemented values are rejected when crossing into wasm", async () => {
	const res = await compileShapes();
	assertThrows(
		() => res.mod.Measure({ Area: () => 1, Scale: () => null }),
		"a JS-implemented value cannot cross into wasm as interface 'Shape'",
	);
	// A wasm handle of an unrelated type is rejected too, instead of trapping
	// inside the dispatcher.
	assertThrows(
		() => res.mod.Measure(new res.mod.Scene()),
		"wasm value does not implement interface 'Shape'",
	);
	// Unexported implementers (facade values) still pass.
	assertEqual(res.mod.Measure(res.mod.NewSquare(3)), 9);
});

test("GoFront JS code uses wasm interfaces (calls, round-trip)", async () => {
	const res = await compileShapes(`func main() {
	var s shapes.Shape = &shapes.Circle{R: 1}
	println(s.Area(), shapes.Measure(s))
	q := shapes.NewSquare(2)
	println(q.Area(), shapes.Measure(q.Scale(2)))
}`);
	assertEqual(res.lines.join("\n"), "3 3\n4 16");
});

test("a JS type implementing a wasm interface is a compile error", () =>
	expectCompileError(
		{
			"shapes/shapes.go": SHAPES_WASM,
			"main.go": `package main

import "./shapes"

type tri struct{}

func (t *tri) Area() float64              { return 1 }
func (t *tri) Scale(f float64) shapes.Shape { return t }

func main() { println(shapes.Measure(&tri{})) }
`,
		},
		"type '*tri' (js) cannot implement wasm interface 'Shape' across the boundary; implement it in a wasm package or pass a func callback",
	));
