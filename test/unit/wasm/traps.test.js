// test/unit/wasm/traps.test.js
// Tests for Phase 3c: Traps, Panics, and Math / Math/bits imports.

import {
	assertEqual,
	compileHybrid,
	compileWasm,
	runWasm,
	section,
	test,
} from "../helpers.js";

section("WASM Traps — Division by Zero & Integer Wraps");

test("Integer division by zero panics in WASM and JS-strict", () => {
	const src = `
package main

func DivZero(a int32) int32 {
    return a / 0
}

func Main() {
    DivZero(10)
}
`;

	const hybrid = compileHybrid(src);
	hybrid.run("Main"); // will assert both JS and WASM threw the exact same panic message
});

test("Integer modulo by zero panics in WASM and JS-strict", () => {
	const src = `
package main

func RemZero(a int32) int32 {
    return a % 0
}

func Main() {
    RemZero(10)
}
`;

	const hybrid = compileHybrid(src);
	hybrid.run("Main");
});

test("MinInt32 / -1 and MinInt64 / -1 wrap without trapping", () => {
	const src = `
package main

func DivMinInt32() int32 {
    var a int32 = -2147483648
    var b int32 = -1
    return a / b
}

func RemMinInt32() int32 {
    var a int32 = -2147483648
    var b int32 = -1
    return a % b
}

func Main() {
    println("div:", DivMinInt32())
    println("rem:", RemMinInt32())
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "div: -2147483648\nrem: 0");
});

test("Explicit panic surfaces as standard Error in JS caller", () => {
	const src = `
package main

func Fail() {
    panic("something went terribly wrong")
}

func Main() {
    Fail()
}
`;

	const hybrid = compileHybrid(src);
	hybrid.run("Main");
});

section("WASM Math — Native Opcode and Imported Transcendental Functions");

test("math package native opcodes and transcendental functions", () => {
	const src = `
package main

import "math"

func CalcMath(x float64) float64 {
    sq := math.Sqrt(x)
    s := math.Sin(0.0)
    c := math.Cos(0.0)
    fl := math.Floor(3.7)
    ce := math.Ceil(3.2)
    ab := math.Abs(-42.0)
    mn := math.Min(10.0, 20.0)
    mx := math.Max(10.0, 20.0)
    return sq + s + c + fl + ce + ab + mn + mx
}

func Main() {
    println("math:", CalcMath(16.0))
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	// 4 (sqrt) + 0 (sin) + 1 (cos) + 3 (floor) + 4 (ceil) + 42 (abs) + 10 (min) + 20 (max) = 84
	assertEqual(res.output, "math: 84");
});

test("math/bits bitwise operations map to instructions", () => {
	const src = `
package main

import "math/bits"

func TestBits32(x uint32) int {
    return bits.LeadingZeros32(x) + bits.TrailingZeros32(x) + bits.OnesCount32(x)
}

func Rotate32(x uint32) uint32 {
    return bits.RotateLeft32(x, 2)
}

func Main() {
    // For x = 8 (0b1000):
    // LeadingZeros: 32 - 4 = 28
    // TrailingZeros: 3
    // OnesCount: 1
    // Total = 32
    println("bits32:", TestBits32(8))
    println("rot32:", Rotate32(1))
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "bits32: 32\nrot32: 4");
});

test("math/bits RotateLeft64 with int32 shift count", () => {
	const src = `
package main

import "math/bits"

func Rotate64(x uint64, k int32) uint64 {
    return bits.RotateLeft64(x, k)
}

func Main() {
    println("rot64:", Rotate64(1, 3))
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "rot64: 8");
});

test("Explicit panic with integer argument", () => {
	const src = `
package main

func Fail() {
    panic(42)
}

func Main() {
    Fail()
}
`;

	const hybrid = compileHybrid(src);
	hybrid.run("Main");
});

test("Nil pointer dereference traps and surfaces as standard Error in JS caller", () => {
	const src = `
package main

type Point struct {
	X int
	Y int
}

func Deref(p *Point) int {
	return p.X + p.Y
}

func Main() {
	var p *Point
	Deref(p)
}
`;

	const { wasm, stringTable } = compileWasm(src);
	let caught = false;
	try {
		const { exports } = runWasm(wasm, { stringTable });
		exports.Main();
	} catch (e) {
		caught = true;
		assertEqual(
			e.message,
			"runtime error: invalid memory address or nil pointer dereference",
		);
	}
	assertEqual(caught, true);
});
