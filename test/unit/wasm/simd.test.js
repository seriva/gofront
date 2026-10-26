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

// ── Value type, operations, masks and overlay ────────────────

const TARGETS = ["wasm", "js"];

async function compileBoth(files, exports, options = {}) {
	const out = {};
	for (const target of TARGETS) {
		const src = {};
		for (const [name, text] of Object.entries(files)) {
			src[name] = text.replace(
				"//gofront:target X",
				`//gofront:target ${target}`,
			);
		}
		out[target] = (
			await compileHybridProject(src, { exports, ...options })
		).mod;
	}
	return out;
}

const f32 = Math.fround;
const sameFloat = (x, y) =>
	(Number.isNaN(x) && Number.isNaN(y)) || Object.is(x, y);

function assertLanes(actual, expected, what) {
	assertEqual(actual.length, expected.length);
	for (let i = 0; i < expected.length; i++) {
		assert(
			sameFloat(actual[i], expected[i]),
			`${what}: lane ${i} got ${actual[i]} want ${expected[i]}`,
		);
	}
}

const REF_VALUES = [
	[1.5, -2.5, 0.5, 2],
	[2.5, 3.5, -0.5, -1.5],
	[0, -0, Infinity, -Infinity],
	[Number.NaN, 1, -3, 7.25],
	[1, 2, 3, 4],
	[-0, 0, 5, Number.NaN],
];

const SIMD_OPS_SOURCE = `//gofront:target X
package ops

import "gofront/simd"

func vec(a0, a1, a2, a3 float32) simd.F32x4 { return simd.F32x4{a0, a1, a2, a3} }

func Unary(op int, a0, a1, a2, a3 float32) (float32, float32, float32, float32) {
	a := vec(a0, a1, a2, a3)
	var r simd.F32x4
	switch op {
	case 0:
		r = a.Neg()
	case 1:
		r = a.Abs()
	case 2:
		r = a.Sqrt()
	case 3:
		r = a.Floor()
	case 4:
		r = a.Ceil()
	case 5:
		r = a.Trunc()
	case 6:
		r = a.RoundToEven()
	case 7:
		r = a.Swizzle(3, 3, 0, 1)
	}
	return r.Lane(0), r.Lane(1), r.Lane(2), r.Lane(3)
}

func Binary(op int, a0, a1, a2, a3, b0, b1, b2, b3 float32) (float32, float32, float32, float32) {
	a := vec(a0, a1, a2, a3)
	b := vec(b0, b1, b2, b3)
	var r simd.F32x4
	switch op {
	case 0:
		r = a.Add(b)
	case 1:
		r = a.Sub(b)
	case 2:
		r = a.Mul(b)
	case 3:
		r = a.Div(b)
	case 4:
		r = a.Min(b)
	case 5:
		r = a.Max(b)
	case 6:
		r = a.MulAdd(b, a)
	case 7:
		r = simd.Shuffle(a, b, 0, 5, 2, 7)
	}
	return r.Lane(0), r.Lane(1), r.Lane(2), r.Lane(3)
}

func Horizontal(a0, a1, a2, a3 float32) float32 {
	return vec(a0, a1, a2, a3).Sum()
}

func Compare(op int, a0, a1, a2, a3, b0, b1, b2, b3 float32) (int, bool, bool, bool, bool, bool, bool) {
	a := vec(a0, a1, a2, a3)
	b := vec(b0, b1, b2, b3)
	var m simd.Mask32x4
	switch op {
	case 0:
		m = a.Equal(b)
	case 1:
		m = a.NotEqual(b)
	case 2:
		m = a.Less(b)
	case 3:
		m = a.LessEqual(b)
	case 4:
		m = a.Greater(b)
	case 5:
		m = a.GreaterEqual(b)
	}
	return m.Bits(), m.Any(), m.All(), m.Lane(0), m.Lane(1), m.Lane(2), m.Lane(3)
}

func MaskOps(op int, a0, a1, a2, a3, b0, b1, b2, b3 float32) (int, bool, bool) {
	a := vec(a0, a1, a2, a3)
	b := vec(b0, b1, b2, b3)
	x := a.Less(b)
	y := a.Greater(simd.Splat(1))
	var m simd.Mask32x4
	switch op {
	case 0:
		m = x.And(y)
	case 1:
		m = x.Or(y)
	case 2:
		m = x.Xor(y)
	case 3:
		m = x.AndNot(y)
	case 4:
		m = x.Not()
	}
	return m.Bits(), m.Any(), m.All()
}

func Select(a0, a1, a2, a3, b0, b1, b2, b3 float32) (float32, float32, float32, float32) {
	a := vec(a0, a1, a2, a3)
	b := vec(b0, b1, b2, b3)
	r := simd.Select(a.Less(b), a, b)
	return r.Lane(0), r.Lane(1), r.Lane(2), r.Lane(3)
}
`;

const refBinary = [
	(a, b) => f32(a + b),
	(a, b) => f32(a - b),
	(a, b) => f32(a * b),
	(a, b) => f32(a / b),
	(a, b) => f32(Math.min(a, b)),
	(a, b) => f32(Math.max(a, b)),
	(a, b) => f32(f32(a * b) + a),
];

function nearestEven(x) {
	if (!Number.isFinite(x)) return x;
	const f = Math.floor(x);
	const d = x - f;
	let r;
	if (d < 0.5) r = f;
	else if (d > 0.5) r = f + 1;
	else r = f % 2 === 0 ? f : f + 1;
	return r === 0 && (x < 0 || Object.is(x, -0)) ? -0 : r;
}

const refUnary = [
	(a) => -a,
	Math.abs,
	(a) => f32(Math.sqrt(a)),
	Math.floor,
	Math.ceil,
	Math.trunc,
	nearestEven,
];

test("F32x4 operations match a scalar [4]float32 reference on both backends", async () => {
	const mods = await compileBoth(
		{
			"ops/ops.go": SIMD_OPS_SOURCE,
			"main.go":
				'package main\nimport "./ops"\nfunc main() { _ = ops.Unary }\n',
		},
		["Unary", "Binary", "Horizontal", "Compare", "MaskOps", "Select"],
	);
	for (const [target, mod] of Object.entries(mods)) {
		for (const a of REF_VALUES) {
			const fa = a.map(f32);
			for (let op = 0; op < refUnary.length; op++) {
				assertLanes(
					mod.Unary(op, ...fa),
					fa.map((x) => f32(refUnary[op](x))),
					`${target} unary ${op} ${fa}`,
				);
			}
			assertLanes(
				mod.Unary(7, ...fa),
				[fa[3], fa[3], fa[0], fa[1]],
				`${target} swizzle`,
			);
			assert(
				sameFloat(
					mod.Horizontal(...fa),
					f32(f32(f32(fa[0] + fa[1]) + fa[2]) + fa[3]),
				),
				`${target} sum ${fa}`,
			);
			for (const b of REF_VALUES) {
				const fb = b.map(f32);
				for (let op = 0; op < refBinary.length; op++) {
					assertLanes(
						mod.Binary(op, ...fa, ...fb),
						fa.map((x, i) => refBinary[op](x, fb[i])),
						`${target} binary ${op} ${fa} ${fb}`,
					);
				}
				assertLanes(
					mod.Binary(7, ...fa, ...fb),
					[fa[0], fb[1], fa[2], fb[3]],
					`${target} shuffle`,
				);
				const cmps = [
					(x, y) => x === y,
					(x, y) => x !== y,
					(x, y) => x < y,
					(x, y) => x <= y,
					(x, y) => x > y,
					(x, y) => x >= y,
				];
				for (let op = 0; op < cmps.length; op++) {
					const lanes = fa.map((x, i) => cmps[op](x, fb[i]));
					const bits = lanes.reduce((n, l, i) => n | (l ? 1 << i : 0), 0);
					assertEqual(
						JSON.stringify(mod.Compare(op, ...fa, ...fb)),
						JSON.stringify([bits, bits !== 0, bits === 15, ...lanes]),
					);
				}
				const x = fa.map((v, i) => v < fb[i]);
				const y = fa.map((v) => v > 1);
				const masks = [
					x.map((v, i) => v && y[i]),
					x.map((v, i) => v || y[i]),
					x.map((v, i) => v !== y[i]),
					x.map((v, i) => v && !y[i]),
					x.map((v) => !v),
				];
				for (let op = 0; op < masks.length; op++) {
					const bits = masks[op].reduce((n, l, i) => n | (l ? 1 << i : 0), 0);
					assertEqual(
						JSON.stringify(mod.MaskOps(op, ...fa, ...fb)),
						JSON.stringify([bits, bits !== 0, bits === 15]),
					);
				}
				assertLanes(
					mod.Select(...fa, ...fb),
					fa.map((v, i) => (v < fb[i] ? v : fb[i])),
					`${target} select`,
				);
			}
		}
	}
});

test("F32x4 rounding ties go to even, Min and Max propagate NaN and order signed zeros", async () => {
	const mods = await compileBoth(
		{
			"ops/ops.go": SIMD_OPS_SOURCE,
			"main.go":
				'package main\nimport "./ops"\nfunc main() { _ = ops.Unary }\n',
		},
		["Unary", "Binary"],
	);
	for (const mod of Object.values(mods)) {
		assertLanes(mod.Unary(6, 0.5, 1.5, 2.5, -2.5), [0, 2, 2, -2], "nearest");
		assertLanes(
			mod.Unary(6, -0.5, -0.4, 3.5, -3.5),
			[-0, -0, 4, -4],
			"nearest sign",
		);
		assertLanes(
			mod.Binary(4, -0, 0, Number.NaN, 1, 0, -0, 1, Number.NaN),
			[-0, -0, Number.NaN, Number.NaN],
			"min",
		);
		assertLanes(
			mod.Binary(5, -0, 0, Number.NaN, 1, 0, -0, 1, Number.NaN),
			[0, 0, Number.NaN, Number.NaN],
			"max",
		);
		// MulAdd rounds twice: 16777217 * 1 + -16777216 is exact only when fused.
		assertLanes(mod.Binary(6, 3, 0, 0, 0, 5, 0, 0, 0), [18, 0, 0, 0], "muladd");
	}
});

const VALUE_SOURCE = `//gofront:target X
package vt

import (
	"fmt"
	"gofront/simd"
	"math"
)

type pt struct {
	V simd.F32x4
	N int
}

type Box[T any] struct{ v T }

func (b *Box[T]) Set(v T) { b.v = v }
func (b Box[T]) Get() T   { return b.v }
func id[T any](x T) T     { return x }

func Equality() string {
	nan := float32(math.NaN())
	a := simd.F32x4{1, 2, 3, 4}
	n := simd.F32x4{nan, 0, 0, 0}
	z1 := simd.F32x4{0, 0, 0, 0}
	z2 := simd.F32x4{float32(math.Copysign(0, -1)), 0, 0, 0}
	out := fmt.Sprint(n == n, n != n, z1 == z2, z1 != z2, a == a, a != z1)
	p1, p2 := pt{a, 1}, pt{a, 1}
	out += fmt.Sprint(" ", p1 == p2, pt{n, 1} == pt{n, 1}, p1 != pt{z1, 1})
	arr1 := [2]simd.F32x4{a, z1}
	arr2 := arr1
	arr2[0] = z1
	out += fmt.Sprint(" ", arr1 == arr2, arr1[0] == a, arr2[0] == z1)
	m1 := a.Less(simd.Splat(2))
	m2 := a.Less(simd.Splat(2))
	out += fmt.Sprint(" ", m1 == m2, m1 != m2, m1 == a.Less(simd.Splat(3)))
	return out
}

func Containers() string {
	a := simd.F32x4{1, 2, 3, 4}
	z1 := simd.F32x4{}
	z2 := simd.F32x4{float32(math.Copysign(0, -1)), 0, 0, 0}
	m := map[simd.F32x4]int{}
	m[a] = 5
	m[simd.F32x4{1, 2, 3, 4}]++
	m[z1] = 1
	m[z2] = 2
	out := fmt.Sprint(len(m), m[a], m[z1])
	v := map[string]simd.F32x4{"k": a}
	out += fmt.Sprint(" ", v["k"] == a, v["missing"] == z1)
	s := []simd.F32x4{a, a}
	t := append(s, z1)
	t[0] = z1
	out += fmt.Sprint(" ", s[0] == a, t[0] == z1, len(t))
	arr := [2]simd.F32x4{a, a}
	cp := arr
	cp[0] = z1
	out += fmt.Sprint(" ", arr[0] == a, cp[0] == z1)
	var i any = a
	var k any = a
	j, ok := i.(simd.F32x4)
	out += fmt.Sprint(" ", ok, j == a, i == k)
	var b Box[simd.F32x4]
	b.Set(a)
	out += fmt.Sprint(" ", b.Get() == a, id(a) == a)
	f := func() simd.F32x4 { a = a.Add(a); return a }
	f()
	out += fmt.Sprint(" ", a.Lane(0))
	masks := map[simd.Mask32x4]int{}
	masks[a.Less(simd.Splat(3))]++
	masks[a.Less(simd.Splat(3))]++
	out += fmt.Sprint(" ", len(masks))
	return out
}

func Formatting() string {
	a := simd.F32x4{0.5, 2, 3, 4}
	m := a.Less(simd.Splat(1))
	var i any = a
	var mi any = m
	return fmt.Sprintf("%v|%+v|%#v|%T|%v|%v|%v|%#v|%T|%v", a, pt{a, 1}, a, a, i, m, mi, m, m, []simd.F32x4{a})
}
`;

test("F32x4 and Mask32x4 are value types on both backends", async () => {
	const mods = await compileBoth(
		{
			"vt/vt.go": VALUE_SOURCE,
			"main.go":
				'package main\nimport "./vt"\nfunc main() { _ = vt.Equality }\n',
		},
		["Equality", "Containers", "Formatting"],
	);
	for (const [target, mod] of Object.entries(mods)) {
		assertEqual(
			mod.Equality(),
			"false true true false true true true false true false true true true false false",
		);
		assertEqual(
			mod.Containers(),
			"2 6 2 true true true true 3 true true true true true true true 2 1",
		);
		assertEqual(
			mod.Formatting(),
			"[0.5 2 3 4]|{V:[0.5 2 3 4] N:1}|simd.F32x4{0.5, 2, 3, 4}|simd.F32x4|[0.5 2 3 4]|[true false false false]|[true false false false]|simd.Mask32x4{true, false, false, false}|simd.Mask32x4|[[0.5 2 3 4]]",
			target,
		);
	}
});

test("Typechecker diagnostics for masks, swizzles and shuffles", () => {
	const check = (body) =>
		compile(`package main

import "gofront/simd"

func T() {
	${body}
}
`).errors;
	assertErrorContains(
		check("v := simd.F32x4{}; _ = v.Swizzle(0, 1, 2, 4)"),
		"lane index must be a constant integer in range [0, 3]",
	);
	assertErrorContains(
		check("i := 1; v := simd.F32x4{}; _ = v.Swizzle(0, i, 2, 3)"),
		"lane index must be a constant integer in range [0, 3]",
	);
	assertErrorContains(
		check("v := simd.F32x4{}; _ = simd.Shuffle(v, v, 0, 1, 2, 8)"),
		"lane index must be a constant integer in range [0, 7]",
	);
	assertEqual(
		check("v := simd.F32x4{}; _ = simd.Shuffle(v, v, 0, 1, 2, 7)").length,
		0,
	);
	assertErrorContains(
		check("m := simd.F32x4{}.Less(simd.F32x4{}); _ = m.Lane(4)"),
		"lane index must be a constant integer in range [0, 3]",
	);
	assertErrorContains(
		check("m := simd.Mask32x4{true}; _ = m"),
		"simd.Mask32x4 literal cannot have values",
	);
	assertErrorContains(
		check("v := simd.F32x4{}; _ = simd.Select(v, v, v)"),
		"Cannot assign simd.F32x4 to simd.Mask32x4",
	);
	assertErrorContains(
		check("v := simd.F32x4{}; var f simd.F32x4 = v.Less(v); _ = f"),
		"Cannot assign simd.Mask32x4 to simd.F32x4",
	);
});

test("F32x4 operations give the same results in a Binaryen release build", async () => {
	const plain = (
		await compileBoth(
			{
				"ops/ops.go": SIMD_OPS_SOURCE,
				"main.go":
					'package main\nimport "./ops"\nfunc main() { _ = ops.Unary }\n',
			},
			["Unary", "Binary", "Compare", "MaskOps", "Select", "Horizontal"],
		)
	).wasm;
	const release = (
		await compileBoth(
			{
				"ops/ops.go": SIMD_OPS_SOURCE,
				"main.go":
					'package main\nimport "./ops"\nfunc main() { _ = ops.Unary }\n',
			},
			["Unary", "Binary", "Compare", "MaskOps", "Select", "Horizontal"],
			{ wasmOpt: true, release: true },
		)
	).wasm;
	for (const a of REF_VALUES) {
		const fa = a.map(f32);
		for (let op = 0; op < 8; op++) {
			assertLanes(
				release.Unary(op, ...fa),
				plain.Unary(op, ...fa),
				`unary ${op}`,
			);
		}
		for (const b of REF_VALUES) {
			const fb = b.map(f32);
			for (let op = 0; op < 8; op++) {
				assertLanes(
					release.Binary(op, ...fa, ...fb),
					plain.Binary(op, ...fa, ...fb),
					`binary ${op}`,
				);
			}
			for (let op = 0; op < 6; op++) {
				assertEqual(
					JSON.stringify(release.Compare(op, ...fa, ...fb)),
					JSON.stringify(plain.Compare(op, ...fa, ...fb)),
				);
			}
			for (let op = 0; op < 5; op++) {
				assertEqual(
					JSON.stringify(release.MaskOps(op, ...fa, ...fb)),
					JSON.stringify(plain.MaskOps(op, ...fa, ...fb)),
				);
			}
			assertLanes(
				release.Select(...fa, ...fb),
				plain.Select(...fa, ...fb),
				"select",
			);
		}
		assert(
			sameFloat(release.Horizontal(...fa), plain.Horizontal(...fa)),
			"sum",
		);
	}
});
