// test/unit/wasm/simd.test.js
// Tests for Phase 3 — WASM SIMD (gofront/simd, F32x4 vector math, load/store, parity).

import {
	assert,
	assertEqual,
	assertErrorContains,
	assertThrows,
	compile,
	compileHybridProject,
	section,
	test,
} from "../helpers.js";

function assertDeep(actual, expected) {
	assertEqual(JSON.stringify(actual), JSON.stringify(expected));
}

section("WASM SIMD — gofront/simd (Phase 3)");

test("F32x4 zero value, composite literal, and Splat in WASM", async () => {
	const res = await compileHybridProject(
		{
			"pkg/math.go": `//gofront:target wasm
package pkg

import "gofront/simd"

func ZeroTest() (float32, float32, float32, float32) {
	var v simd.F32x4
	return v.Lane(0), v.Lane(1), v.Lane(2), v.Lane(3)
}

func ConstLitTest() (float32, float32, float32, float32) {
	v := simd.F32x4{1.5, 2.5, 3.5, 4.5}
	return v.Lane(0), v.Lane(1), v.Lane(2), v.Lane(3)
}

func PartialLitTest() (float32, float32, float32, float32) {
	v := simd.F32x4{10.0, 20.0}
	return v.Lane(0), v.Lane(1), v.Lane(2), v.Lane(3)
}

func DynamicLitTest(a, b, c, d float32) (float32, float32, float32, float32) {
	v := simd.F32x4{a, b, c, d}
	return v.Lane(0), v.Lane(1), v.Lane(2), v.Lane(3)
}

func SplatTest(f float32) (float32, float32, float32, float32) {
	v1 := simd.Splat(f)
	v2 := v1.Splat(f * 2)
	return v1.Lane(0), v1.Lane(3), v2.Lane(1), v2.Lane(2)
}
`,
			"main.go": `package main

import "./pkg"

func main() {
	_ = pkg.ZeroTest
}
`,
		},
		{
			exports: [
				"ZeroTest",
				"ConstLitTest",
				"PartialLitTest",
				"DynamicLitTest",
				"SplatTest",
			],
		},
	);

	assertDeep(res.mod.ZeroTest(), [0, 0, 0, 0]);
	assertDeep(res.mod.ConstLitTest(), [1.5, 2.5, 3.5, 4.5]);
	assertDeep(res.mod.PartialLitTest(), [10, 20, 0, 0]);
	assertDeep(res.mod.DynamicLitTest(7, 8, 9, 10), [7, 8, 9, 10]);
	assertDeep(res.mod.SplatTest(3.25), [3.25, 3.25, 6.5, 6.5]);
});

test("F32x4 vector arithmetic: Add, Sub, Mul, Div, Min, Max", async () => {
	const res = await compileHybridProject(
		{
			"vec/vec.go": `//gofront:target wasm
package vec

import "gofront/simd"

func TestOps() (float32, float32, float32, float32, float32, float32) {
	a := simd.F32x4{10.0, 20.0, 30.0, 40.0}
	b := simd.F32x4{2.0, 5.0, 10.0, 4.0}

	add := a.Add(b) // 12, 25, 40, 44
	sub := a.Sub(b) // 8, 15, 20, 36
	mul := a.Mul(b) // 20, 100, 300, 160
	div := a.Div(b) // 5, 4, 3, 10
	min := a.Min(b) // 2, 5, 10, 4
	max := a.Max(b) // 10, 20, 30, 40

	return add.Lane(0), sub.Lane(1), mul.Lane(2), div.Lane(3), min.Lane(0), max.Lane(2)
}
`,
			"main.go": `package main

import "./vec"

func main() {
	_ = vec.TestOps
}
`,
		},
		{ exports: ["TestOps"] },
	);

	assertDeep(res.mod.TestOps(), [12, 15, 300, 10, 2, 30]);
});

test("F32x4 Dot3 and Dot4", async () => {
	const res = await compileHybridProject(
		{
			"vec/vec.go": `//gofront:target wasm
package vec

import "gofront/simd"

func TestDot() (float32, float32) {
	a := simd.F32x4{1.0, 2.0, 3.0, 4.0}
	b := simd.F32x4{5.0, 6.0, 7.0, 8.0}

	d3 := a.Dot3(b) // 1*5 + 2*6 + 3*7 = 5 + 12 + 21 = 38
	d4 := a.Dot4(b) // 38 + 4*8 = 38 + 32 = 70

	return d3, d4
}
`,
			"main.go": `package main

import "./vec"

func main() {
	_ = vec.TestDot
}
`,
		},
		{ exports: ["TestDot"] },
	);

	assertDeep(res.mod.TestDot(), [38, 70]);
});

test("F32x4 Lane and WithLane", async () => {
	const res = await compileHybridProject(
		{
			"vec/vec.go": `//gofront:target wasm
package vec

import "gofront/simd"

const LaneTwo = 2

func TestWithLane() (float32, float32, float32, float32) {
	v := simd.F32x4{1.0, 2.0, 3.0, 4.0}
	v = v.WithLane(0, 10.0)
	v = v.WithLane(1, 20.0)
	v = v.WithLane(LaneTwo, 30.0)
	v = v.WithLane(3, 40.0)
	return v.Lane(0), v.Lane(1), v.Lane(LaneTwo), v.Lane(3)
}
`,
			"main.go": `package main

import "./vec"

func main() {
	_ = vec.TestWithLane
}
`,
		},
		{ exports: ["TestWithLane"] },
	);

	assertDeep(res.mod.TestWithLane(), [10, 20, 30, 40]);
});

test("F32x4 LoadF32x4 and StoreF32x4 with shared.Float32 linear memory", async () => {
	const res = await compileHybridProject(
		{
			"sim/sim.go": `//gofront:target wasm
package sim

import (
	"gofront/shared"
	"gofront/simd"
)

var Buf = shared.NewFloat32(16)

func InitBuf() {
	for i := 0; i < len(Buf); i++ {
		Buf[i] = float32(i) * 1.5
	}
}

func ShiftAddStore(readIdx, writeIdx int) {
	v := simd.LoadF32x4(Buf, readIdx)
	v = v.Add(simd.Splat(100.0))
	simd.StoreF32x4(Buf, writeIdx, v)
}

func BadLoad(idx int) float32 {
	v := simd.LoadF32x4(Buf, idx)
	return v.Lane(0)
}

func BadStore(idx int) {
	simd.StoreF32x4(Buf, idx, simd.Splat(99.0))
}
`,
			"main.go": `package main

import "./sim"

func main() {
	_ = sim.InitBuf
}
`,
		},
		{
			exports: ["Buf", "InitBuf", "ShiftAddStore", "BadLoad", "BadStore"],
		},
	);

	res.mod.InitBuf();
	// Check Buf initial values
	const buf = res.mod.Buf;
	assertEqual(buf[0], 0);
	assertEqual(buf[1], 1.5);
	assertEqual(buf[2], 3.0);
	assertEqual(buf[3], 4.5);

	// Load from index 4..7 and write to index 8..11 with +100
	// indices 4..7 were [6.0, 7.5, 9.0, 10.5]
	res.mod.ShiftAddStore(4, 8);

	assertEqual(buf[8], 106.0);
	assertEqual(buf[9], 107.5);
	assertEqual(buf[10], 109.0);
	assertEqual(buf[11], 110.5);

	// Bounds checks: len is 16. Reading at index 13 needs 13+4=17 > 16 -> out of bounds!
	assertThrows(() => res.mod.BadLoad(13));
	// Reading at negative index -> out of bounds!
	assertThrows(() => res.mod.BadLoad(-1));
	// Storing at index 14 -> out of bounds!
	assertThrows(() => res.mod.BadStore(14));
	// Storing at negative index -> out of bounds!
	assertThrows(() => res.mod.BadStore(-2));
	// 64-bit bounds check: integer wrap-around (e.g. 1n << 32n) must throw!
	assertThrows(() => res.mod.BadLoad(4294967296n));
	assertThrows(() => res.mod.BadStore(4294967296n));
	assertThrows(() => res.mod.BadLoad(4294967297n));
	assertThrows(() => res.mod.BadStore(4294967297n));
});

test("simd.F32x4 parity between WASM and JS targets", async () => {
	const wasmRes = await compileHybridProject(
		{
			"calc/calc.go": `//gofront:target wasm
package calc

import "gofront/simd"

func Run(x, y float32) (float32, float32, float32, float32) {
	a := simd.F32x4{x, y, 1.0, 2.0}
	b := simd.F32x4{3.0, 4.0, x, y}
	c := a.Add(b).Mul(simd.Splat(0.5)).WithLane(0, 99.0)
	d3 := c.Dot3(b)
	d4 := c.Dot4(b)
	return c.Lane(0), c.Lane(1), d3, d4
}
`,
			"main.go": `package main

import "./calc"

func main() {
	_ = calc.Run
}
`,
		},
		{ exports: ["Run"] },
	);

	const jsRes = await compileHybridProject(
		{
			"calc/calc.go": `//gofront:target js
package calc

import "gofront/simd"

func Run(x, y float32) (float32, float32, float32, float32) {
	a := simd.F32x4{x, y, 1.0, 2.0}
	b := simd.F32x4{3.0, 4.0, x, y}
	c := a.Add(b).Mul(simd.Splat(0.5)).WithLane(0, 99.0)
	d3 := c.Dot3(b)
	d4 := c.Dot4(b)
	return c.Lane(0), c.Lane(1), d3, d4
}
`,
			"main.go": `package main

import "./calc"

func main() {
	_ = calc.Run
}
`,
		},
		{ exports: ["Run"] },
	);

	const wasmOut = wasmRes.mod.Run(1.23, 4.56);
	const jsOut = jsRes.mod.Run(1.23, 4.56);

	assertEqual(wasmOut.length, jsOut.length);
	for (let i = 0; i < wasmOut.length; i++) {
		assert(
			Math.abs(wasmOut[i] - jsOut[i]) < 1e-5,
			`Parity mismatch at index ${i}: wasm=${wasmOut[i]} js=${jsOut[i]}`,
		);
	}
});

test("simd.F32x4 crossing JS<->WASM boundary is rejected with diagnostic", async () => {
	let caught = null;
	try {
		await compileHybridProject(
			{
				"math/math.go": `//gofront:target wasm
package math

import "gofront/simd"

func ExportedSimd(v simd.F32x4) simd.F32x4 {
	return v
}
`,
				"main.go": `package main

import "./math"

func main() {
	_ = math.ExportedSimd
}
`,
			},
			{ exports: ["ExportedSimd"] },
		);
	} catch (e) {
		caught = e;
	}

	assert(caught !== null, "Must fail compilation when F32x4 crosses boundary");
	assert(
		caught.message.includes(
			"simd.F32x4 cannot cross the JS↔WASM boundary in 1.7.0 (use shared.Float32 instead)",
		),
		`Error message must suggest shared.Float32, got: ${caught.message}`,
	);
});

test("Typechecker diagnostics for invalid SIMD usage", () => {
	const c1 = compile(`
package main

import "gofront/simd"

func Test() {
	v := simd.F32x4{1, 2, 3, 4, 5}
	_ = v
}
`);
	assertErrorContains(c1.errors, "too many values in simd.F32x4 literal");

	const c2 = compile(`
package main

import "gofront/simd"

func Test() {
	v := simd.F32x4{1, 2, 3, 4}
	_ = v.Lane(4)
}
`);
	assertErrorContains(
		c2.errors,
		"lane index must be a constant integer in range [0, 3]",
	);

	const c3 = compile(`
package main

import "gofront/simd"

func Test(i int) {
	v := simd.F32x4{1, 2, 3, 4}
	_ = v.Lane(i)
}
`);
	assertErrorContains(
		c3.errors,
		"lane index must be a constant integer in range [0, 3]",
	);
});

test("F32x4 LoadF32x4 and StoreF32x4 in JS target", async () => {
	const res = await compileHybridProject(
		{
			"sim/sim.go": `//gofront:target js
package sim

import (
	"gofront/shared"
	"gofront/simd"
)

var Buf = shared.NewFloat32(16)

func TestLoadStore() float32 {
	Buf[0] = 1.0
	Buf[1] = 2.0
	Buf[2] = 3.0
	Buf[3] = 4.0
	v := simd.LoadF32x4(Buf, 0)
	v = v.Add(simd.Splat(10.0))
	simd.StoreF32x4(Buf, 4, v)
	return Buf[4]
}

func BadLoad(i int) float32 {
	v := simd.LoadF32x4(Buf, i)
	return v.Lane(0)
}

func BadStore(i int) {
	simd.StoreF32x4(Buf, i, simd.Splat(1.0))
}
`,
			"main.go": `package main

import "./sim"

func main() {
	_ = sim.TestLoadStore
}
`,
		},
		{ exports: ["TestLoadStore", "BadLoad", "BadStore"] },
	);

	assertEqual(res.mod.TestLoadStore(), 11.0);
	assertThrows(() => res.mod.BadLoad(-1));
	assertThrows(() => res.mod.BadLoad(13));
	assertThrows(() => res.mod.BadStore(-1));
	assertThrows(() => res.mod.BadStore(13));
});

test("Lane index with constant lexical scoping across functions", () => {
	const c = compile(`
package main

import "gofront/simd"

const Lane = 0

func first() float32 {
	const Lane = 3
	v := simd.F32x4{10, 20, 30, 40}
	return v.Lane(Lane)
}

func second() {
	const Lane = 10
	_ = Lane
}

func third() float32 {
	// Must resolve to package-level Lane = 0, NOT poisoned by second()!
	v := simd.F32x4{10, 20, 30, 40}
	return v.Lane(Lane)
}
`);
	assertEqual(c.errors.length, 0);
});

test("F32x4 Min/Max and Splat preserve NaN and signed zero in WASM and JS", async () => {
	const wasmRes = await compileHybridProject(
		{
			"check/check.go": `//gofront:target wasm
package check

import "gofront/simd"

func TestNaN(nan float32) (float32, float32, float32) {
	s := simd.Splat(nan)
	a := simd.F32x4{1.0, 2.0, 3.0, 4.0}
	min := a.Min(s)
	max := a.Max(s)
	return s.Lane(0), min.Lane(0), max.Lane(0)
}
`,
			"main.go": `package main

import "./check"

func main() {
	_ = check.TestNaN
}
`,
		},
		{ exports: ["TestNaN"] },
	);

	const jsRes = await compileHybridProject(
		{
			"check/check.go": `//gofront:target js
package check

import "gofront/simd"

func TestNaN(nan float32) (float32, float32, float32) {
	s := simd.Splat(nan)
	a := simd.F32x4{1.0, 2.0, 3.0, 4.0}
	min := a.Min(s)
	max := a.Max(s)
	return s.Lane(0), min.Lane(0), max.Lane(0)
}
`,
			"main.go": `package main

import "./check"

func main() {
	_ = check.TestNaN
}
`,
		},
		{ exports: ["TestNaN"] },
	);

	const wasmOut = wasmRes.mod.TestNaN(NaN);
	const jsOut = jsRes.mod.TestNaN(NaN);

	assert(Number.isNaN(wasmOut[0]), "WASM Splat must preserve NaN");
	assert(
		Number.isNaN(wasmOut[1]),
		"WASM Min must return NaN when operand is NaN",
	);
	assert(
		Number.isNaN(wasmOut[2]),
		"WASM Max must return NaN when operand is NaN",
	);

	assert(Number.isNaN(jsOut[0]), "JS Splat must preserve NaN");
	assert(Number.isNaN(jsOut[1]), "JS Min must return NaN when operand is NaN");
	assert(Number.isNaN(jsOut[2]), "JS Max must return NaN when operand is NaN");
});
