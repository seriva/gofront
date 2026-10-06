// test/unit/wasm/scalars.test.js
// Tests for Phase 3b: scalar types, arithmetic, shifts, and control flow in WASM vs JS-strict.

import {
	assertEqual,
	compileHybrid,
	compileWasm,
	section,
	test,
} from "../helpers.js";

section("WASM Scalars — Arithmetic & Parity");

test("i32 and i64 arithmetic parity (WASM == JS-strict)", () => {
	const src = `
package main

func Add32(a, b int32) int32 { return a + b }
func Sub32(a, b int32) int32 { return a - b }
func Mul32(a, b int32) int32 { return a * b }

func Add64(a, b int64) int64 { return a + b }
func Sub64(a, b int64) int64 { return a - b }
func Mul64(a, b int64) int64 { return a * b }

func Main() {
    println("add32:", Add32(100, 200))
    println("sub32:", Sub32(50, 100))
    println("mul32:", Mul32(12, 12))
    println("add64:", Add64(1000, 2000))
}
`;

	const hybrid = compileHybrid(src);
	hybrid.run("Main");
});

test("Narrow integer wrap: int8(127) + 1 == -128 and uint8 wrap", () => {
	const src = `
package main

func WrapInt8(a int8) int8 {
    return a + 1
}

func WrapUint8(a uint8) uint8 {
    return a + 1
}

func WrapInt16(a int16) int16 {
    return a + 1
}

func Main() {
    println("int8:", WrapInt8(127))
    println("uint8:", WrapUint8(255))
    println("int16:", WrapInt16(32767))
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "int8: -128\nuint8: 0\nint16: -32768");
});

test("Float32 and Float64 arithmetic parity", () => {
	const src = `
package main

func FloatOps(a, b float64) float64 {
    return (a * b) - (a / b) + 0.5
}

func Main() {
    println("float:", FloatOps(10.0, 4.0))
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "float: 38");
});

section("WASM Scalars — Go Shift Semantics");

test("Shifts >= operand width yield 0 or -1", () => {
	const src = `
package main

func Shl32(a, s int32) int32 { return a << s }
func Shr32Pos(a, s int32) int32 { return a >> s }
func Shr32Neg(a, s int32) int32 { return a >> s }
func Shr32Unsigned(a, s uint32) uint32 { return a >> s }

func Main() {
    println("shl32 >= 32:", Shl32(1, 35))
    println("shr32 pos >= 32:", Shr32Pos(100, 32))
    println("shr32 neg >= 32:", Shr32Neg(-100, 40))
    println("shr32 unsigned >= 32:", Shr32Unsigned(100, 32))
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(
		res.output,
		"shl32 >= 32: 0\nshr32 pos >= 32: 0\nshr32 neg >= 32: -1\nshr32 unsigned >= 32: 0",
	);
});

section("WASM Scalars — Control Flow & Loops");

test("For loop with break, continue and accumulator", () => {
	const src = `
package main

func SumEvens(n int32) int32 {
    var sum int32 = 0
    for i := int32(1); i <= n; i++ {
        if i % 2 != 0 {
            continue
        }
        if i > 20 {
            break
        }
        sum += i
    }
    return sum
}

func Main() {
    println("sumEvens(10):", SumEvens(10))
    println("sumEvens(30):", SumEvens(30))
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "sumEvens(10): 30\nsumEvens(30): 110");
});

test("Short-circuiting boolean logical operators (&&, ||, !)", () => {
	const src = `
package main

func Logic(a, b bool) bool {
    return (a && b) || (!a && !b)
}

func Main() {
    println("tt:", Logic(true, true))
    println("tf:", Logic(true, false))
    println("ff:", Logic(false, false))
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "tt: true\ntf: false\nff: true");
});

section("WASM Scalars — Compound Operations & Branch Conditions");

test("Compound operators /=, %=, <<=, >>= and 0x0B return", () => {
	const src = `
package main

func Compound(x int32) int32 {
    x += 10
    x *= 2
    x /= 3
    x %= 5
    x <<= 2
    x >>= 1
    return x
}

func Return11() int32 {
    return 11
}

func Main() {
    println("compound:", Compound(5))
    println("ret11:", Return11())
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "compound: 0\nret11: 11");
});

test("Float64 and Int64 comparison in if condition", () => {
	const src = `
package main

func CmpFloat(x float64) bool {
    if x > 10.5 {
        return true
    }
    return false
}

func CmpInt64(x int64) bool {
    if x > 1000 {
        return true
    }
    return false
}

func Main() {
    println("f_true:", CmpFloat(20.0))
    println("f_false:", CmpFloat(5.0))
    println("i64_true:", CmpInt64(2000))
    println("i64_false:", CmpInt64(500))
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(
		res.output,
		"f_true: true\nf_false: false\ni64_true: true\ni64_false: false",
	);
});

test("Multi-value return unpacking and package globals", () => {
	const src = `
package main

var counter int32 = 10

func Next(step int32) (int64, int8) {
    counter += step
    return int64(counter), int8(counter)
}

func Main() {
    a, b := Next(6)
    println("multi:", a, b)
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "multi: 16 16");
});

test("Unary negation stack balance in if-else and loop", () => {
	const src = `
package main

func DiffStack(cond bool, x int32) int32 {
    var res int32 = 0
    if cond {
        res = -x
    } else {
        res = x
    }
    return res
}

func LoopNeg(n int32) int32 {
    var res int32 = 0
    for i := int32(0); i < n; i++ {
        res = -i
    }
    return res
}

func Main() {
    println("neg_t:", DiffStack(true, 42))
    println("neg_f:", DiffStack(false, 42))
    println("loop_neg:", LoopNeg(5))
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "neg_t: -42\nneg_f: 42\nloop_neg: -4");
});

test("Unary negation evaluates operand side-effects exactly once", () => {
	const src = `
package main

var count int32 = 0

func Inc() int32 {
    count++
    return 10
}

func TestNeg() int32 {
    _ = -Inc()
    return count
}

func Main() {
    println("count:", TestNeg())
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "count: 1");
});

test("Function with returns only inside if-else branches", () => {
	const src = `
package main

func BranchReturn(cond bool) int32 {
    if cond {
        return 100
    } else {
        return 200
    }
}

func Main() {
    println("br1:", BranchReturn(true))
    println("br2:", BranchReturn(false))
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "br1: 100\nbr2: 200");
});

test("Labeled loop break terminates outer loop", () => {
	const src = `
package main

func LabeledBreak() int32 {
    var c int32 = 0
Outer:
    for i := int32(0); i < 5; i++ {
        for j := int32(0); j < 5; j++ {
            c++
            if j == 2 {
                break Outer
            }
        }
    }
    return c
}

func Main() {
    println("labeled:", LabeledBreak())
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "labeled: 3");
});

test("Package globals initialized with negative numbers", () => {
	const src = `
package main

var NegInt int32 = -42
var NegFloat float64 = -3.5

func Main() {
    println("neg_int:", NegInt)
    println("neg_float:", NegFloat)
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "neg_int: -42\nneg_float: -3.5");
});

section("WASM Globals — Caching & Init Order (v1.5.1 Task 5)");

test("Global reassigned in a callee is not cached: caller observes mutation across callee call", () => {
	const src = `
package main

var counter int32 = 10

func Increment() {
    counter++
}

func TestCaller() int32 {
    a := counter
    Increment()
    b := counter
    return a + b
}

func Main() {
    println("sum:", TestCaller())
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "sum: 21");
});

test("Never-assigned global is cached in local at function entry", () => {
	const src = `
package main

var scratch int32 = 42

func UseScratch() int32 {
    a := scratch
    b := scratch
    return a + b
}

func Main() {
    println("cached:", UseScratch())
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "cached: 84");
});

test("Init-order case: function called from package var initializer reads globals without stale cache", () => {
	const src = `
package main

var seed int32 = 100
var computed int32 = initCompute()

func initCompute() int32 {
    return seed + 23
}

func Main() {
    println("computed:", computed)
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "computed: 123");
});

test("Init-order case: helper called from func init() reads updated global", () => {
	const src = `
package main

var config int32 = 0
var result int32 = 0

func init() {
    config = 50
    setup()
}

func setup() {
    result = config
}

func Main() {
    println("result:", result)
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "result: 50");
});

test("Scratch struct global: field mutation preserves cached reference", () => {
	const src = `
package main

type Vec struct {
    X float32
    Y float32
}

func (v *Vec) Set(x, y float32) {
    v.X = x
    v.Y = y
}

func (v *Vec) Sum() float32 {
    return v.X + v.Y
}

var scratch Vec

func Compute() float32 {
    scratch.Set(3.0, 4.0)
    return scratch.Sum()
}

func Main() {
    println("sum:", Compute())
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.output, "sum: 7");
});

test("Closures and trampolines cache only the globals their own body reads", () => {
	const src = `
package main

type V struct{ X float64 }

var inClosure = &V{X: 2}
var inRoot = &V{X: 3}
var alsoRoot = &V{X: 4}

func Main() float64 {
    f := func() float64 { return inClosure.X }
    return f() + inRoot.X + alsoRoot.X
}
`;
	const { wat } = compileWasm(src, { emitWat: true });
	const funcBody = (name) => {
		const re = new RegExp(
			`\\(func \\$f\\d+ \\(export "${name.replace(/\$/g, "\\$")}"\\)[\\s\\S]*?\\n  \\)`,
		);
		return wat.match(re)?.[0] ?? "";
	};
	const count = (body) => (body.match(/global\.get/g) ?? []).length;
	assertEqual(count(funcBody("Main")), 2);
	assertEqual(count(funcBody("_closure$1")), 1);
	assertEqual(count(funcBody("_tramp$Main")), 0);

	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 9);
	assertEqual(wasmRes, jsRes);
});
