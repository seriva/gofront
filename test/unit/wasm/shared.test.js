// test/unit/wasm/shared.test.js
// Task H6.1: `gofront/shared` linear-memory buffers — zero-copy TypedArray
// views over the wasm memory, startup-only allocation, boundary marshalling
// and the typechecker's allocation / conversion discipline.

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

const SIM_WASM = `//gofront:target wasm
package sim

import "gofront/shared"

const Max = 8

var Positions = shared.NewFloat32(Max * 2)
var Counts = shared.NewUint8(4)
var Big = shared.NewFloat64(3)
var Small = shared.NewInt16(2)

func init() {
	for i := 0; i < len(Positions); i++ {
		Positions[i] = float32(i) * 0.5
	}
	Small[0] = -300
	Big[2] = 1e300
}

func Step(dt float32) {
	for i := range Positions {
		Positions[i] += dt
	}
	Counts[0]++
	Counts[1] = 250
	Counts[1] += 10
}

func Sum() float32 {
	var s float32
	for _, v := range Positions {
		s += v
	}
	return s
}

func SumSub(lo, hi int) float32 {
	sub := Positions.Subarray(lo, hi)
	var s float32
	for i := 0; i < len(sub); i++ {
		s += sub[i]
	}
	return s
}

func First(b shared.Float32) float32 { return b[0] }

func Half() shared.Float32 { return Positions.Subarray(0, Max) }

func CopyOut() []float32 {
	out := make([]float32, 4)
	copy(out, Positions)
	return out
}

func CopyIn(src []float32) int {
	return copy(Positions, src)
}

func Count1() int { return int(Counts[1]) }
func SmallVal() int { return int(Small[0]) }
func BigVal() float64 { return Big[2] }
func OOB(i int) float32 { return Positions[i] }
`;

const MAIN = `package main

import "./sim"

func main() {
	println(len(sim.Positions))
	sim.Step(1)
	println(sim.Sum())
}
`;

const EXPORTS = [
	"Positions",
	"Counts",
	"Step",
	"Sum",
	"SumSub",
	"First",
	"Half",
	"CopyOut",
	"CopyIn",
	"Count1",
	"SmallVal",
	"BigVal",
	"OOB",
];

section("WASM shared memory — linear-memory buffers (H6.1)");

test("exported shared vars are zero-copy TypedArray views over wasm memory", async () => {
	const res = await compileHybridProject(
		{ "sim/sim.go": SIM_WASM, "main.go": MAIN },
		{ exports: EXPORTS },
	);
	assertEqual(res.lines.join("\n"), "16\n76");
	const { Positions, Counts } = res.mod;
	assert(Positions instanceof Float32Array, "Positions is a Float32Array");
	assert(Counts instanceof Uint8Array, "Counts is a Uint8Array");
	assertEqual(Positions.length, 16);
	// Step(1) ran from main: 0.5*i + 1
	assertEqual(Positions[0], 1);
	assertEqual(Positions[3], 2.5);
	// JS writes are visible to wasm without copying
	Positions[0] = 100;
	assertEqual(res.mod.Sum(), 175);
	// wasm writes are visible to JS
	res.mod.Step(1);
	assertEqual(Positions[0], 101);
	assertEqual(Counts[0], 2);
});

test("element types: narrow ints wrap, signed loads sign-extend, f64 exact", async () => {
	const res = await compileHybridProject(
		{ "sim/sim.go": SIM_WASM, "main.go": MAIN },
		{ exports: EXPORTS },
	);
	assertEqual(res.mod.Count1(), 4); // (250 + 10) & 0xff
	assertEqual(res.mod.SmallVal(), -300);
	assertEqual(res.mod.BigVal(), 1e300);
});

test("Subarray views alias the parent buffer and bounds-check", async () => {
	const res = await compileHybridProject(
		{ "sim/sim.go": SIM_WASM, "main.go": MAIN },
		{ exports: EXPORTS },
	);
	assertEqual(res.mod.SumSub(0, 2), 2.5);
	const half = res.mod.Half();
	assert(half instanceof Float32Array, "Half() returns a Float32Array");
	assertEqual(half.length, 8);
	assertEqual(half.buffer, res.mod.Positions.buffer);
	half[1] = 42;
	assertEqual(res.mod.Positions[1], 42);
	assertThrows(() => res.mod.SumSub(4, 100), "slice bounds out of range");
	assertThrows(() => res.mod.OOB(16), "index out of range");
	assertThrows(() => res.mod.OOB(-1), "index out of range");
});

test("shared params accept only views over the wasm memory", async () => {
	const res = await compileHybridProject(
		{ "sim/sim.go": SIM_WASM, "main.go": MAIN },
		{ exports: EXPORTS },
	);
	assertEqual(res.mod.First(res.mod.Positions), 1);
	assertEqual(res.mod.First(res.mod.Positions.subarray(3)), 2.5);
	assertThrows(
		() => res.mod.First(new Float32Array(2)),
		"view over the wasm shared memory",
	);
	assertThrows(
		() => res.mod.First(new Float64Array(res.mod.Positions.buffer, 0, 1)),
		"expected a Float32Array",
	);
});

test("copy() between shared buffers and GC slices", async () => {
	const res = await compileHybridProject(
		{ "sim/sim.go": SIM_WASM, "main.go": MAIN },
		{ exports: EXPORTS },
	);
	assertEqual(JSON.stringify(res.mod.CopyOut()), "[1,1.5,2,2.5]");
	assertEqual(res.mod.CopyIn([9, 8]), 2);
	assertEqual(res.mod.Positions[0], 9);
	assertEqual(res.mod.Positions[1], 8);
	assertEqual(res.mod.Positions[2], 2);
});

test("memory is sized at startup and exported", async () => {
	const res = await compileHybridProject(
		{
			"big/big.go": `//gofront:target wasm
package big

import "gofront/shared"

// 3 pages worth of f64 (plus the initial page is grown during start only).
var Data = shared.NewFloat64(3 * 65536 / 8)

func Fill(v float64) {
	for i := range Data {
		Data[i] = v
	}
}
`,
			"main.go": `package main

import "./big"

func main() { big.Fill(2); println(len(big.Data)) }
`,
		},
		{ exports: ["Data", "Fill"] },
	);
	assertEqual(res.lines.join("\n"), "24576");
	assertEqual(res.mod.Data.length, 24576);
	assertEqual(res.mod.Data[24575], 2);
	assert(res.js.includes("__w$memory"), "facade binds the memory export");
});

section("WASM shared memory — JS target & typechecker discipline");

test("JS target lowers shared buffers to plain TypedArrays", () => {
	const r = compile(`package main

import "gofront/shared"

var buf = shared.NewFloat32(8)

func Sum() float32 {
	var s float32
	for _, v := range buf {
		s += v
	}
	sub := buf.Subarray(2, 4)
	return s + sub[0] + float32(len(sub))
}

func main() { println(Sum()) }
`);
	assertEqual(r.errors.length, 0);
	assert(r.js.includes("new Float32Array(8)"), "NewFloat32 -> Float32Array");
	assert(r.js.includes(".subarray(2, 4)"), "Subarray -> subarray");
});

test("shared.New* is rejected outside package-level vars and init()", () => {
	const r = compile(`package main

import "gofront/shared"

func main() {
	x := shared.NewFloat32(2)
	_ = x
}
`);
	assertErrorContains(
		r.errors,
		"must be called from a package-level var initializer or init()",
	);
});

test("shared.New* is rejected inside closures within init()", () => {
	const r = compile(`package main

import "gofront/shared"

var buf = shared.NewFloat32(2)

func init() {
	f := func() { buf = shared.NewFloat32(4) }
	f()
}

func main() {}
`);
	assertErrorContains(
		r.errors,
		"must be called from a package-level var initializer or init()",
	);
});

test("implicit shared <-> slice conversions are rejected", () => {
	const r1 = compile(`package main

import "gofront/shared"

var buf = shared.NewFloat32(2)

func main() {
	var ys []float32 = buf
	_ = ys
}
`);
	assertErrorContains(r1.errors, "cannot be passed as a GC slice");
	const r2 = compile(`package main

import "gofront/shared"

var buf = shared.NewFloat32(2)

func main() {
	buf = []float32{1, 2}
}
`);
	assertErrorContains(r2.errors, "cannot be used as a shared buffer");
});

test("slicing, append and cap on shared buffers are rejected", () => {
	const r = compile(`package main

import "gofront/shared"

var buf = shared.NewFloat32(2)

func main() {
	_ = buf[0:1]
	_ = append(buf, 1)
	_ = cap(buf)
}
`);
	assertErrorContains(r.errors, "use .Subarray(lo, hi)");
	assertErrorContains(r.errors, "shared buffers have a fixed size");
	assertErrorContains(r.errors, "cannot use cap()");
});

test("copy() with a shared buffer requires identical element types", () => {
	const r1 = compile(`package main

import "gofront/shared"

var buf = shared.NewFloat32(2)

func main() {
	src := []float64{1, 2}
	copy(buf, src)
}
`);
	assertErrorContains(r1.errors, "element types differ");
	const r2 = compile(`package main

import "gofront/shared"

var buf = shared.NewFloat32(2)

func main() {
	m := map[int]float32{}
	copy(buf, m)
}
`);
	assertErrorContains(r2.errors, "cannot copy between");
	const ok = compile(`package main

import "gofront/shared"

var buf = shared.NewFloat32(2)
var other = shared.NewFloat32(2)

func main() {
	copy(buf, []float32{1})
	copy(buf, other)
}
`);
	assertEqual(ok.errors.length, 0);
});

test("negative constant index into a shared buffer is a compile error", () => {
	const r = compile(`package main

import "gofront/shared"

var buf = shared.NewFloat32(2)

func main() { buf[-1] = 1 }
`);
	assertErrorContains(r.errors, "index must not be negative");
});

test("oversized shared allocations panic instead of wrapping", async () => {
	let caught = null;
	try {
		await compileHybridProject(
			{
				"s/s.go": `//gofront:target wasm
package s

import "gofront/shared"

// 2^30 * 4 bytes does not fit the i32 address space.
var Huge = shared.NewFloat32(1 << 30)

func Len() int { return len(Huge) }
`,
				"main.go": `package main

import "./s"

func main() { println(s.Len()) }
`,
			},
			{ exports: ["Huge", "Len"] },
		);
	} catch (e) {
		caught = e;
	}
	assert(caught !== null, "expected a runtime panic");
	assert(
		caught.message.includes("shared buffer length out of range"),
		`unexpected: ${caught.message}`,
	);
});

test("gofront/shared is rejected in both packages", async () => {
	let caught = null;
	try {
		await compileHybridProject({
			"m/m.go": `//gofront:target both
package m

import "gofront/shared"

var Buf = shared.NewFloat32(2)
`,
			"main.go": `package main

import "./m"

func main() { println(len(m.Buf)) }
`,
		});
	} catch (e) {
		caught = e;
	}
	assert(caught !== null, "expected a compile error");
	assert(
		caught.message.includes("requires a wasm-only package"),
		`unexpected: ${caught.message}`,
	);
});
