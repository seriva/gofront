// GoFront test suite — math (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileFiles } from "../../../src/compiler.js";
import {
	assert,
	assertContains,
	assertFourWay,
	section,
	test,
} from "../helpers.js";

section("math (Go-source)");

test("rounding, classification, limits and constants match Go", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"math"
)

func main() {
	nan := math.NaN()
	inf := math.Inf(1)
	ninf := math.Inf(-1)
	negz := math.Copysign(0, -1)
	vals := []float64{0, negz, 0.5, -0.5, 1.5, 2.5, -2.5, 0.49999999999999994, 1e300, -1e300, 4503599627370497, 3.7, -3.7, inf, ninf, nan}
	for _, v := range vals {
		fmt.Println(v, math.Floor(v), math.Ceil(v), math.Trunc(v), math.Round(v), math.Abs(v), math.Signbit(v), math.IsNaN(v), math.IsInf(v, 0), math.IsInf(v, 1), math.IsInf(v, -1), math.Sqrt(v))
	}
	fmt.Println(math.Float64bits(negz), math.Float64bits(1.5), math.Float64frombits(0x400921FB54442D18), math.Float32bits(1.5), math.Float32frombits(0x40490fdb))
	fmt.Println(math.Float64bits(math.Copysign(0, -1)) == 0x8000000000000000)
	for _, a := range []float64{0, negz, 1, -1, inf, ninf, nan} {
		for _, b := range []float64{0, negz, 2, -2, inf, ninf, nan} {
			fmt.Println(a, b, math.Max(a, b), math.Min(a, b), math.Copysign(a, b), math.Dim(a, b), math.Remainder(a, b), math.Mod(a, b), math.Hypot(a, b), math.Pow(a, b), math.Atan2(a, b))
		}
	}
	fmt.Println(math.Signbit(math.Max(negz, 0)), math.Signbit(math.Min(0, negz)), math.Signbit(math.Round(-0.2)))
	fmt.Println(math.Remainder(5, 3), math.Remainder(-7, 2), math.Remainder(7.5, 2), math.Remainder(1e-310, 3e-310), math.Remainder(5, 5), math.Signbit(math.Remainder(-5, 5)))
	fmt.Println(math.Sqrt(5e-324), math.Sqrt(1e308), math.Sqrt(2), math.Sqrt(1e-320), math.Sqrt(0.25))
	i, f := math.Modf(-3.25)
	fmt.Println(i, f)
	i, f = math.Modf(1e300)
	fmt.Println(i, f)
	i, f = math.Modf(inf)
	fmt.Println(i, f)
	i, f = math.Modf(0.75)
	fmt.Println(i, f)
	fr, ex := math.Frexp(48)
	fmt.Println(fr, ex, math.Ldexp(0.75, 6), math.RoundToEven(2.5), math.Nextafter(1, 2))
	fmt.Println(math.Inf(0), math.Inf(5), math.Inf(-3))
	fmt.Println(math.Exp2(10), math.Cbrt(27), math.Log2(8), math.Log10(1000), math.Log1p(0), math.Expm1(0), math.Sinh(0), math.Cosh(0), math.Tanh(0))
	fmt.Println(math.E, math.Pi, math.Phi, math.Sqrt2, math.SqrtE, math.SqrtPi, math.SqrtPhi, math.Ln2, math.Log2E, math.Ln10, math.Log10E)
	fmt.Println(math.MaxFloat32, math.SmallestNonzeroFloat32, math.MaxFloat64, math.SmallestNonzeroFloat64)
	fmt.Println(math.MaxInt8, math.MinInt8, math.MaxInt16, math.MinInt16, math.MaxInt32, math.MinInt32, math.MaxUint8, math.MaxUint16, math.MaxUint32)
	var a int64 = math.MaxInt64
	var b int64 = math.MinInt64
	var c uint64 = math.MaxUint64
	fmt.Println(a, b, c)
	var x float32 = math.MaxFloat32
	fmt.Println(x, float32(math.SmallestNonzeroFloat32))
	fmt.Println(uint64(math.MaxUint64)>>60, math.MaxInt64>>60)
}
`,
		`0 0 0 0 0 0 false false false false false 0
-0 -0 -0 -0 -0 0 true false false false false -0
0.5 0 1 0 1 0.5 false false false false false 0.7071067811865476
-0.5 -1 -0 -0 -1 0.5 true false false false false NaN
1.5 1 2 1 2 1.5 false false false false false 1.224744871391589
2.5 2 3 2 3 2.5 false false false false false 1.5811388300841898
-2.5 -3 -2 -2 -3 2.5 true false false false false NaN
0.49999999999999994 0 1 0 0 0.49999999999999994 false false false false false 0.7071067811865475
1e+300 1e+300 1e+300 1e+300 1e+300 1e+300 false false false false false 1e+150
-1e+300 -1e+300 -1e+300 -1e+300 -1e+300 1e+300 true false false false false NaN
4.503599627370497e+15 4.503599627370497e+15 4.503599627370497e+15 4.503599627370497e+15 4.503599627370497e+15 4.503599627370497e+15 false false false false false 6.7108864e+07
3.7 3 4 3 4 3.7 false false false false false 1.9235384061671346
-3.7 -4 -3 -3 -4 3.7 true false false false false NaN
+Inf +Inf +Inf +Inf +Inf +Inf false false true true false +Inf
-Inf -Inf -Inf -Inf -Inf +Inf true false true false true NaN
NaN NaN NaN NaN NaN NaN false true false false false NaN
9223372036854775808 4609434218613702656 3.141592653589793 1069547520 3.1415927
true
0 0 0 0 0 0 NaN NaN 0 1 0
0 -0 0 -0 -0 0 NaN NaN 0 1 3.141592653589793
0 2 2 0 0 0 0 0 2 0 0
0 -2 0 -2 -0 2 0 0 2 +Inf 3.141592653589793
0 +Inf +Inf 0 0 0 0 0 +Inf 0 0
0 -Inf 0 -Inf -0 +Inf 0 0 +Inf +Inf 3.141592653589793
0 NaN NaN NaN 0 NaN NaN NaN NaN NaN NaN
-0 0 0 -0 0 0 NaN NaN 0 1 -0
-0 -0 -0 -0 -0 0 NaN NaN 0 1 -3.141592653589793
-0 2 2 -0 0 0 -0 -0 2 0 -0
-0 -2 -0 -2 -0 2 -0 -0 2 +Inf -3.141592653589793
-0 +Inf +Inf -0 0 0 -0 -0 +Inf 0 -0
-0 -Inf -0 -Inf -0 +Inf -0 -0 +Inf +Inf -3.141592653589793
-0 NaN NaN NaN 0 NaN NaN NaN NaN NaN NaN
1 0 1 0 1 1 NaN NaN 1 1 1.5707963267948966
1 -0 1 -0 -1 1 NaN NaN 1 1 1.5707963267948966
1 2 2 1 1 0 1 1 2.23606797749979 1 0.4636476090008061
1 -2 1 -2 -1 3 1 1 2.23606797749979 1 2.677945044588987
1 +Inf +Inf 1 1 0 1 1 +Inf 1 0
1 -Inf 1 -Inf -1 +Inf 1 1 +Inf 1 3.141592653589793
1 NaN NaN NaN 1 NaN NaN NaN NaN 1 NaN
-1 0 0 -1 1 0 NaN NaN 1 1 -1.5707963267948966
-1 -0 -0 -1 -1 0 NaN NaN 1 1 -1.5707963267948966
-1 2 2 -1 1 0 -1 -1 2.23606797749979 1 -0.4636476090008061
-1 -2 -1 -2 -1 1 -1 -1 2.23606797749979 1 -2.677945044588987
-1 +Inf +Inf -1 1 0 -1 -1 +Inf 1 -0
-1 -Inf -1 -Inf -1 +Inf -1 -1 +Inf 1 -3.141592653589793
-1 NaN NaN NaN 1 NaN NaN NaN NaN NaN NaN
+Inf 0 +Inf 0 +Inf +Inf NaN NaN +Inf 1 1.5707963267948966
+Inf -0 +Inf -0 -Inf +Inf NaN NaN +Inf 1 1.5707963267948966
+Inf 2 +Inf 2 +Inf +Inf NaN NaN +Inf +Inf 1.5707963267948966
+Inf -2 +Inf -2 -Inf +Inf NaN NaN +Inf 0 1.5707963267948966
+Inf +Inf +Inf +Inf +Inf NaN NaN NaN +Inf +Inf 0.7853981633974483
+Inf -Inf +Inf -Inf -Inf +Inf NaN NaN +Inf 0 2.356194490192345
+Inf NaN +Inf NaN +Inf NaN NaN NaN +Inf NaN NaN
-Inf 0 0 -Inf +Inf 0 NaN NaN +Inf 1 -1.5707963267948966
-Inf -0 -0 -Inf -Inf 0 NaN NaN +Inf 1 -1.5707963267948966
-Inf 2 2 -Inf +Inf 0 NaN NaN +Inf +Inf -1.5707963267948966
-Inf -2 -2 -Inf -Inf 0 NaN NaN +Inf 0 -1.5707963267948966
-Inf +Inf +Inf -Inf +Inf 0 NaN NaN +Inf +Inf -0.7853981633974483
-Inf -Inf -Inf -Inf -Inf NaN NaN NaN +Inf 0 -2.356194490192345
-Inf NaN NaN -Inf +Inf NaN NaN NaN +Inf NaN NaN
NaN 0 NaN NaN NaN NaN NaN NaN NaN 1 NaN
NaN -0 NaN NaN NaN NaN NaN NaN NaN 1 NaN
NaN 2 NaN NaN NaN NaN NaN NaN NaN NaN NaN
NaN -2 NaN NaN NaN NaN NaN NaN NaN NaN NaN
NaN +Inf +Inf NaN NaN NaN NaN NaN +Inf NaN NaN
NaN -Inf NaN -Inf NaN NaN NaN NaN +Inf NaN NaN
NaN NaN NaN NaN NaN NaN NaN NaN NaN NaN NaN
false true true
-1 1 -0.5 1e-310 0 true
2.2227587494850775e-162 1e+154 1.4142135623730951 9.99994433575849e-161 0.5
-3 -0.25
1e+300 0
+Inf NaN
0 0.75
0.75 6 48 2 1.0000000000000002
+Inf +Inf -Inf
1024 3 3 3 0 0 0 1 0
2.718281828459045 3.141592653589793 1.618033988749895 1.4142135623730951 1.6487212707001282 1.772453850905516 1.272019649514069 0.6931471805599453 1.4426950408889634 2.302585092994046 0.4342944819032518
3.4028234663852886e+38 1.401298464324817e-45 1.7976931348623157e+308 5e-324
127 -128 32767 -32768 2147483647 -2147483648 255 65535 4294967295
9223372036854775807 -9223372036854775808 18446744073709551615
3.4028235e+38 1e-45
15 7
`,
	);
});

test("FMA, RoundToEven, Nextafter, Frexp and bit casts match Go", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"math"
)

func main() {
	fmt.Println(math.FMA(2, 3, 4), math.FMA(1.5, -2, 5), math.FMA(1e308, 10, -1e308), math.FMA(0.1, 10, -1), math.FMA(math.Inf(1), 0, 1), math.FMA(1e-300, 1e-300, 0))
	fmt.Println(math.FMA(3, 1e-320, 1e-320), math.FMA(-2, 3, 6), math.FMA(1<<30, 1<<30, -(1<<60)))
	for _, v := range []float64{0.5, 1.5, 2.5, -0.5, -2.5, 1e300, 4503599627370497.5, math.Inf(1), math.NaN()} {
		fmt.Println(math.RoundToEven(v))
	}
	fmt.Println(math.Nextafter(1, 2), math.Nextafter(1, 0), math.Nextafter(0, 1), math.Nextafter(-1, 0), math.Nextafter32(1, 2), math.Nextafter32(0, -1))
	fr, ex := math.Frexp(5e-324)
	fmt.Println(fr, ex, math.Ldexp(1, -1074), math.Ldexp(1, 1024), math.Ldexp(0.5, 1025))
	var f32 float32 = 1.1
	fmt.Println(math.Float32bits(f32), math.Float32frombits(0x3f8ccccd), math.Float32bits(float32(math.Inf(-1))))
	fmt.Println(math.Cbrt(-8), math.Log(math.E), math.Exp(1), math.Atan2(1, 1), math.Sinh(1), math.Cosh(1), math.Tanh(1), math.Mod(7, -3), math.Mod(-7, 3))
}
`,
		`10 2 +Inf 5.551115123125783e-17 NaN 0
4e-320 0 0
0
2
2
-0
-2
1e+300
4.503599627370498e+15
+Inf
NaN
1.0000000000000002 0.9999999999999999 5e-324 -0.9999999999999999 1.0000001 -1e-45
0.5 -1073 5e-324 +Inf +Inf
1066192077 1.1 4286578688
-2 1 2.718281828459045 0.7853981633974483 1.1752011936438014 1.5430806348152437 0.7615941559557649 1 -1
`,
	);
});

test("natives compile Floor, Sqrt and Abs to host expressions", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-math-"));
	try {
		const goPath = join(dir, "main.go");
		writeFileSync(
			goPath,
			`package main

import (
	"fmt"
	"math"
)

func main() {
	x := 2.5
	fmt.Println(math.Floor(x), math.Sqrt(x), math.Abs(-x))
}
`,
		);
		const on = compileFiles([goPath], { forceTarget: "both", natives: true });
		assertContains(on.js, "Math.floor(x)");
		assertContains(on.js, "Math.sqrt(x)");
		const off = compileFiles([goPath], { forceTarget: "both", natives: false });
		assertContains(off.js, "(Floor$$math(x), Sqrt$$math(x)");
		assert(!on.js.includes("(Floor$$math(x)"), "natives on calls the host");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
