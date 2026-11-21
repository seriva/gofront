// GoFront test suite — numeric operands need identical types
//
// Arithmetic and comparison operands, `%` and the bit operators, and the
// implicit int -> float64 conversion. Each rule is checked on every target
// (`js`, `both`, `wasm`). The per-case corpus lives in
// test/unit/fixtures/conformance; this file covers the generic-code,
// defined-type and untyped-constant edges.

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	assertEqual,
	assertErrorContains,
	compile,
	section,
	summarize,
	test,
} from "../helpers.js";

const TARGETS = ["js", "both", "wasm"];

function rejectsEverywhere(source, message) {
	for (const target of TARGETS) {
		const { errors } = compile(source, { target });
		try {
			assertErrorContains(errors, message);
		} catch (e) {
			e.message = `${target}: ${e.message}`;
			throw e;
		}
	}
}

function acceptsEverywhere(source) {
	for (const target of TARGETS) {
		const { errors } = compile(source, { target });
		assertEqual(errors.length, 0, `${target}: ${errors?.[0]}`);
	}
}

section("Arithmetic operands (identical types)");

test("mixed int and float64 operands are a mismatch with a position", () => {
	const { errors } = compile(`package main
func main() {
	a := 1
	f := 2.5
	_ = a + f
}`);
	assertErrorContains(
		errors,
		"invalid operation: a + f (mismatched types int and float64)",
	);
	assertErrorContains(errors, "at line 5:");
});

test("compound assignment of a different integer type is rejected", () => {
	rejectsEverywhere(
		`package main
func main() {
	var a int32 = 1
	var b int64 = 2
	a += b
	_ = a
}`,
		"int64",
	);
});

test("defined type result keeps its type through an untyped constant", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
type Celsius float64
func main() {
	var a Celsius = 1.5
	g := a * 1.5
	h := g + a
	var k Celsius = h
	fmt.Println(h, k)
}
`,
		"3.75 3.75\n",
	);
});

test("an integer variable times an integral float constant stays an integer", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
func main() {
	x := 3
	y := x * 2.0
	var z int = y
	fmt.Println(z)
}
`,
		"6\n",
	);
});

test("an integer variable divided by an integral float constant truncates like an integer", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
func main() {
	x := 3
	y := x / 2.0
	fmt.Println(y, y == 1, y*2)
}
`,
		"1 true 2\n",
	);
});

test("Celsius + float64 (typed) is a mismatch, Celsius + 1.5 is valid", () => {
	rejectsEverywhere(
		`package main
type Celsius float64
func main() {
	var c Celsius = 1
	f := 2.5
	_ = c + f
}`,
		"mismatched types Celsius and float64",
	);
	acceptsEverywhere(`package main
type Celsius float64
func main() {
	var c Celsius = 1
	_ = c + 1.5
	_ = 1.5 + c
}`);
});

test("int64 << uint8 and float32 arithmetic stay valid", () => {
	acceptsEverywhere(`package main
func main() {
	var a int64 = 1
	var n uint8 = 3
	var f, g float32 = 1, 2
	_ = a << n
	_ = f * g
}`);
});

test("generic arithmetic over a type parameter is unchanged", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
type Number interface{ ~int | ~float64 }
type Celsius float64
func Sum[T Number](xs []T) T {
	var s T
	for _, x := range xs {
		s = s + x
	}
	return s * 2
}
func Scale[T Number](x T, k T) T { return x*k + T(1) }
func main() {
	fmt.Println(Sum([]int{1, 2, 3}), Sum([]float64{0.5, 1}), Sum([]Celsius{1, 2}))
	fmt.Println(Scale(2, 3), Scale(1.5, 2))
}
`,
		"12 3 6\n7 4\n",
	);
});

test("a generic call result mixed with another numeric type is a mismatch", () => {
	rejectsEverywhere(
		`package main
type Number interface{ ~int | ~float64 }
func Id[T Number](x T) T { return x }
func main() {
	i := 1
	_ = Id(2.5) + i
}`,
		"mismatched types float64 and int",
	);
});

section("Comparison operands");

test("comparing different typed basic operands is a mismatch", () => {
	rejectsEverywhere(
		`package main
type Celsius float64
type Fahrenheit float64
func main() {
	var c Celsius = 1
	var f Fahrenheit = 1
	_ = c < f
}`,
		"invalid operation: c < f (mismatched types Celsius and Fahrenheit)",
	);
	rejectsEverywhere(
		`package main
type B bool
func main() {
	var b B
	t := true
	_ = b != t
}`,
		"mismatched types B and bool",
	);
});

test("comparisons against constants, nil, any and type parameters stay valid", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
type Celsius float64
type Ordered interface{ ~int | ~float64 | ~string }
func Max[T Ordered](a, b T) T {
	if a > b {
		return a
	}
	return b
}
func main() {
	var c Celsius = 2
	var v any = 2
	var p *int
	var e error
	var b byte = 'a'
	fmt.Println(c == 2, c < 2.5, v == 2, p == nil, e == nil, b == 'a')
	fmt.Println(Max(1, 2), Max(Celsius(1.5), c), Max("a", "b"))
}
`,
		"true true true true true true\n2 2 b\n",
	);
});

section("Integer-only operators");

test("% and bit operators reject floats, including through constants", () => {
	rejectsEverywhere(
		`package main
func main() {
	f := 1.5
	_ = f % 2
}`,
		"operator % not defined on f (variable of type float64)",
	);
	rejectsEverywhere(
		`package main
func main() {
	f := 1.5
	_ = 3 & f
}`,
		"operator & not defined on f (variable of type float64)",
	);
	rejectsEverywhere(
		`package main
func main() {
	_ = 5.5 % 2.0
}`,
		"operator % not defined on 5.5 (untyped float constant)",
	);
	rejectsEverywhere(
		`package main
type Celsius float64
func main() {
	var c Celsius = 1
	c &^= 1
}`,
		"operator &^ not defined on c (variable of type Celsius)",
	);
});

test("integers keep every integer-only operator, with untyped constants", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
type Mode uint8
func Mod[T ~int | ~int64](a, b T) T { return a % b }
func main() {
	var x uint8 = 14
	var m Mode = 6
	n := 7
	x %= 5
	m |= 1
	m ^= 2
	n &^= 2
	n %= 4
	fmt.Println(x, m, n, 7%3, n&1|2^1, m&^1, Mod(9, 4), n%2.0)
}
`,
		"4 5 1 1 2 4 1 1\n",
	);
});

section("No implicit int to float64");

test("int reaches float64 only through a conversion", () => {
	const cases = [
		[
			"variable declaration",
			"i := 3\n\tvar f float64 = i\n\t_ = f",
			"cannot use i (variable of type int) as float64 value in variable declaration",
		],
		[
			"assignment",
			"i := 3\n\tf := 1.5\n\tf = i\n\t_ = f",
			"cannot use i (variable of type int) as float64 value in assignment",
		],
		[
			"compound assignment",
			"i := 3\n\tf := 1.5\n\tf += i\n\t_ = f",
			"invalid operation: f += i (mismatched types float64 and int)",
		],
		[
			"argument",
			"i := 3\n\t_ = half(i)",
			"cannot use i (variable of type int) as float64 value in argument",
		],
		["return statement", "_ = back(2)", "as float64 value in return statement"],
		[
			"slice literal element",
			"i := 3\n\t_ = []float64{1, i}",
			"as float64 value",
		],
	];
	for (const [, body, want] of cases) {
		rejectsEverywhere(
			`package main
func half(x float64) float64 { return x / 2 }
func back(n int) float64 { return n }
func main() {
	${body}
}`,
			want,
		);
	}
});

test("explicit conversions and untyped constants still reach float64", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
func half(x float64) float64 { return x / 2 }
func mean[T ~int | ~float64](xs []T) float64 {
	var s float64
	for _, x := range xs {
		s += float64(x)
	}
	return s / float64(len(xs))
}
func main() {
	i := 3
	var f float64 = float64(i)
	f += 1
	f = f * 2
	g := []float64{1, 2, float64(i)}
	fmt.Println(f, half(float64(i)), half(4), g, mean([]int{1, 2, 4}))
}
`,
		"8 1.5 2 [1 2 3] 2.3333333333333335\n",
	);
});

test("an integral float constant shift count is converted to an integer", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
const c = 2.0
func main() {
	x := 1
	fmt.Println(x<<1.0, x<<c, 8>>1.0)
}
`,
		"2 4 4\n",
	);
});

test("string and complex results keep the defined operand type", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
type S string
type MyC complex128
func main() {
	var a, b S = "x", "y"
	var c S = a + b
	var x, y MyC = 1i, 2i
	var z MyC = x + y
	fmt.Println(c, z)
}
`,
		"xy (0+3i)\n",
	);
});

function assertOneError(body, message) {
	const { errors } = compile(`package main\nfunc main() {\n${body}\n}\n`);
	assertErrorContains(errors, message);
	assertEqual(errors.length, 1, errors.join(" | "));
}

test("compound assignment reports one constant error", () => {
	const over = "300 (untyped int constant) overflows int8";
	const trunc = "1.5 (untyped float constant) truncated to int";
	assertOneError("var x int8\nx += 300\n_ = x", over);
	assertOneError('m := map[string]int8{}\nm["a"] += 300', over);
	assertOneError("var x int\nx += 1.5\n_ = x", trunc);
	assertOneError("var x int\nfor i := 0; i < 1; i += 1.5 {\n_ = x\n}", trunc);
	assertOneError('m := map[string]int{}\nm["a"] += 1.5', trunc);
	assertOneError(
		"const f = 1.5\nvar x int\nx += f\n_ = x",
		"1.5 (untyped float constant 1.5) truncated to int",
	);
});

test("compound assignment on any reports only the mismatch", () => {
	assertOneError(
		"var v any = 2\nv += 1 << 64",
		"v += 1 << 64 (mismatched types any and untyped int)",
	);
	assertOneError(
		"var v interface{} = 2\nv += 1 << 64",
		"v += 1 << 64 (mismatched types interface{} and untyped int)",
	);
});

test("a constant shift of 1.0 folds to an integer on every target", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	fmt.Println(1.0 << 2)
}`,
		"4\n",
	);
});

test("a non-constant shift in an interface context keeps the int default", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	s := uint(1)
	var v any = 1 << s
	fmt.Println(v)
}`,
		"2\n",
	);
});

test("a non-constant shift converted to uint64 is computed in 64 bits", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	s := uint(60)
	fmt.Println(uint64(1 << s))
}`,
		"1152921504606846976\n",
	);
});

test("an unconstrained type parameter context reports one error for a shift", () => {
	const { errors } = compile(`package main

func G[T any](s uint) {
	var x T = 1 << s
	_ = x
}`);
	assertErrorContains(errors, "cannot use 1 << s");
	assertEqual(errors.length, 1);
});

test("an untyped sum with a shift reports the shift once as float64", () => {
	const { errors } = compile(`package main

func main() {
	s := uint(1)
	var f float64 = 1.5 + (1 << s)
	_ = f
}`);
	assertErrorContains(
		errors,
		"shifted operand 1 (type float64) must be integer",
	);
	assertEqual(errors.length, 1);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
