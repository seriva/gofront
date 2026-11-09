// GoFront test suite — operators, formatting, data structures

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	assertEqual,
	assertProgramOutput,
	compile,
	compileHybrid,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

// ── Bitwise operators as expressions ─────────────────────────

section("Bitwise operators (expressions)");

test("& (AND) expression", () => {
	const js = compile(`package main
func main() {
	x := 15 & 9
	console.log(x)
}`).js;
	assertEqual(runJs(js), "9");
});

test("| (OR) expression", () => {
	const js = compile(`package main
func main() {
	x := 5 | 10
	console.log(x)
}`).js;
	assertEqual(runJs(js), "15");
});

test("^ (XOR) expression", () => {
	const js = compile(`package main
func main() {
	x := 12 ^ 10
	console.log(x)
}`).js;
	assertEqual(runJs(js), "6");
});

test("<< (left shift) expression", () => {
	const js = compile(`package main
func main() {
	x := 1 << 4
	console.log(x)
}`).js;
	assertEqual(runJs(js), "16");
});

test(">> (right shift) expression", () => {
	const js = compile(`package main
func main() {
	x := 32 >> 2
	console.log(x)
}`).js;
	assertEqual(runJs(js), "8");
});

test("^ (bitwise NOT / complement) unary", () => {
	const js = compile(`package main
func main() {
	x := ^0
	console.log(x)
}`).js;
	// ^0 in Go is -1 (two's complement); JS ~0 is also -1
	assertEqual(runJs(js), "-1");
});

test("+ (unary plus) expression", () => {
	const js = compile(`package main
func main() {
	x := 5
	console.log(+x)
}`).js;
	assertEqual(runJs(js), "5");
});

// ── Integer division truncation ───────────────────────────────

section("Integer division");

test("int / int truncates toward zero", () => {
	const js = compile(`package main
func main() {
	console.log(10 / 3)
	console.log(7 / 2)
	console.log(-7 / 2)
}`).js;
	assertEqual(runJs(js), "3\n3\n-3");
});

test("type alias int division truncates toward zero", () => {
	const js = compile(`package main
type MyInt = int
func main() {
	var a MyInt = 7
	var b MyInt = 2
	console.log(a / b)
	var c MyInt = -7
	console.log(c / b)
}`).js;
	assertEqual(runJs(js), "3\n-3");
});

test("float64 / float64 is not truncated", () => {
	const js = compile(`package main
func main() {
	a := 7.0
	b := 2.0
	console.log(a / b)
}`).js;
	assertEqual(runJs(js), "3.5");
});

// ── String indexing ───────────────────────────────────────────

section("String indexing");

test("s[i] returns the byte value (charCodeAt) at that position", () => {
	// Go spec: s[i] on a string returns a byte (uint8 integer), not a character
	const js = compile(`package main
func main() {
	s := "ABC"
	console.log(s[0])
	console.log(s[1])
}`).js;
	assertEqual(runJs(js), "65\n66");
});

test("byte arithmetic on string index", () => {
	const { js, errors } = compile(`package main
func main() {
  s := "ABC"
  println(s[0] - 65)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0");
});

test("string indexing in expression context", () => {
	const { js, errors } = compile(`package main
func main() {
  s := "hello"
  println(s[0] == 104)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

// ── Full slice xs[:] ─────────────────────────────────────────

section("Slice expressions");

test("xs[:] produces a copy", () => {
	const js = compile(`package main
func main() {
	xs := []int{1, 2, 3}
	ys := xs[:]
	console.log(len(ys))
	console.log(ys[0])
}`).js;
	assertEqual(runJs(js), "3\n1");
});

test("xs[n:] slices from n to end", () => {
	const js = compile(`package main
func main() {
	xs := []int{10, 20, 30, 40}
	ys := xs[2:]
	console.log(len(ys))
	console.log(ys[0])
}`).js;
	assertEqual(runJs(js), "2\n30");
});

test("string slice s[lo:hi]", () => {
	const js = compile(`package main
func main() {
	s := "hello"
	console.log(s[1:4])
}`).js;
	assertEqual(runJs(js), "ell");
});

// ── Array types [n]T ─────────────────────────────────────────

section("Array types");

test("[n]T array literal and indexing", () => {
	const js = compile(`package main
func main() {
	xs := [3]int{10, 20, 30}
	console.log(xs[0])
	console.log(xs[2])
}`).js;
	assertEqual(runJs(js), "10\n30");
});

test("len([n]T) returns n", () => {
	const js = compile(`package main
func main() {
	xs := [4]string{"a", "b", "c", "d"}
	console.log(len(xs))
}`).js;
	assertEqual(runJs(js), "4");
});

// ── Map with non-string keys ──────────────────────────────────

section("Map with non-string keys");

test("map[int]string — access by int key", () => {
	const js = compile(`package main
func main() {
	m := map[int]string{1: "one", 2: "two"}
	console.log(m[1])
	console.log(m[2])
}`).js;
	assertEqual(runJs(js), "one\ntwo");
});

test("map[int]int — zero value for missing key", () => {
	const js = compile(`package main
func main() {
	m := map[int]int{1: 42}
	console.log(m[99])
}`).js;
	assertEqual(runJs(js), "0");
});

test("map access with call expr key evaluates key only once", () => {
	const js = compile(`package main
var count int
func getKey() string {
	count++
	return "k"
}
func main() {
	m := map[string]int{"k": 5}
	v := m[getKey()]
	console.log(v, count)
}`).js;
	assertEqual(runJs(js), "5 1");
});

// ── for range with only blank vars ───────────────────────────

section("for range — blank variables");

test("for range body runs once per element (value unused)", () => {
	// Range with index-only binding; body modifies n without referencing i
	// (i gets the slice type from range expr — using it in arithmetic would type-error)
	const js = compile(`package main
func main() {
	n := 0
	xs := []int{1, 2, 3}
	for i := range xs {
		console.log(i)
		n = n + 1
	}
	console.log(n)
}`).js;
	// i outputs 0, 1, 2 and n outputs 3
	assertEqual(runJs(js), "0\n1\n2\n3");
});

// ── for range — index only on string ─────────────────────────

section("for range — index-only on string");

test("for i := range string iterates indices", () => {
	// Range over string with index-only binding; console.log is any so no type conflict
	const js = compile(`package main
func main() {
	for i := range "abc" {
		console.log(i)
	}
}`).js;
	assertEqual(runJs(js), "0\n1\n2");
});

// ── for range — assignment (not define) ──────────────────────

section("for range — assignment to existing variables");

test("for i, v = range slice with any-typed vars compiles", () => {
	// Assignment-range with any-typed lhs vars; GoFront generates const destructuring
	// which shadows outer vars — verify it compiles without error
	const { errors } = compile(`package main
func main() {
	var i any
	var v any
	xs := []int{10, 20, 30}
	for i, v = range xs {
		console.log(i, v)
	}
}`);
	assertEqual(errors.length, 0);
});

// ── new(T) for struct types ───────────────────────────────────

section("Local type declarations");

test("type declared inside function body is usable", () => {
	const js = compile(`package main
func main() {
	type Pair struct { A int; B int }
	p := Pair{A: 3, B: 7}
	console.log(p.A + p.B)
}`).js;
	assertEqual(runJs(js), "10");
});

// ── make([]T, n, cap) with capacity hint ─────────────────────

section("make with capacity");

test("make([]int, n, cap) ignores capacity and creates length-n slice", () => {
	const js = compile(`package main
func main() {
	xs := make([]int, 3, 10)
	console.log(len(xs))
	console.log(xs[0])
}`).js;
	assertEqual(runJs(js), "3\n0");
});

test("make(map[string]int, n) ignores hint and creates empty map", () => {
	const js = compile(`package main
func main() {
	m := make(map[string]int, 16)
	m["a"] = 1
	console.log(len(m))
}`).js;
	assertEqual(runJs(js), "1");
});

// ═════════════════════════════════════════════════════════════
// strings package
// ── Unsigned unary operators and 64-bit shifts (both targets) ─

section("Unsigned unary operators and 64-bit shifts");

function parity(body, expected) {
	const res = compileHybrid(`package main

func Main() int64 {
${body}
}
`).run("Main");
	assertEqual(Number(res.jsRes), expected);
	assertEqual(Number(res.wasmRes), expected);
}

test("^uint8 and -uint32 wrap to the unsigned range", () => {
	parity(
		`	var a uint8 = 5
	var z uint32 = 1
	return int64(^a)*10000000000 + int64(-z)`,
		250 * 10000000000 + 4294967295,
	);
});

test("-uint16 and ^uint32 wrap to the unsigned range", () => {
	parity(
		`	var a uint16 = 1
	var b uint32 = 0
	return int64(-a)*10000000000 + int64(^b)`,
		65535 * 10000000000 + 4294967295,
	);
});

test("int64 shifts by 64 or more follow Go", () => {
	parity(
		`	var x int64 = 1
	n := 70
	return x << n`,
		0,
	);
});

test("64-bit shifts by large count (> 2^32) evaluate to 0 or -1 without BigInt size error", () => {
	parity(
		`	var x int64 = 1
	var neg int64 = -1
	var u uint64 = 0x8000000000000000
	n := 1 << 35
	return (x << n) + (neg >> n) + int64(u >> n)`,
		-1,
	);
});

test("int64(-1) >> 64 is -1 and int64(-1) << 64 is 0", () => {
	parity(
		`	var a int64 = -1
	var b int64 = -1
	n := 64
	return (a>>n)*10 + (b << n)`,
		-10,
	);
});

test("64-bit shifts by 32 or more keep the high bits", () => {
	parity(
		`	var x uint64 = 1
	y := 1
	n := 40
	var m uint = 33
	return int64(x<<n) + int64(y<<m) + int64((x<<n)>>n)`,
		1099511627776 + 8589934592 + 1,
	);
});

test("x <<= n with a wide count shifts past 32 bits", () => {
	parity(
		`	x := 1
	n := 40
	x <<= n
	x >>= 38
	return int64(x)`,
		4,
	);
});

// ═════════════════════════════════════════════════════════════

section("Strict narrow integer operators");

test("narrow integer conversions, negation and Modf sign match Go", async () => {
	const src = `package main

import (
	"fmt"
	"math"
)

func main() {
	r := rune(0xFFFD)
	fmt.Println(byte(0x80 | r>>6&0x3F))
	var x32, y32 int32 = 0, 0
	fmt.Println(int(((x32 - y32 - 1) >> 31) & 1))
	var a int8 = -128
	fmt.Println(int64(-a))
	_, frac := math.Modf(-3)
	fmt.Println(math.Signbit(frac))
}
`;
	await assertProgramOutput(src, "191\n1\n-128\ntrue\n");
});

section("64-bit shifts");

test("64-bit shifts wrap and negative counts panic", async () => {
	const src = `package main

import "fmt"

func shift(x, n int) int { return x << n }

func main() {
	x := 1 << 40
	fmt.Println((x << 3) + (x >> 3))
	y := 3
	fmt.Println(y << 62)
	z := 1 << 50
	fmt.Println(z << 35)
	defer func() { fmt.Println(recover()) }()
	n := -1
	fmt.Println(shift(x, n))
}
`;
	await assertProgramOutput(
		src,
		"8933531975680\n-4611686018427387904\n0\nruntime error: negative shift amount\n",
	);
});

section("Exact 64-bit integer arithmetic (Task 1.3)");

test("int64 and uint64 exact arithmetic, overflow wrap and conversions", async () => {
	const src = `package main

import (
	"fmt"
	"math"
)

type xorshift uint64

func (r *xorshift) Next() uint64 {
	*r ^= *r << 13
	*r ^= *r >> 7
	*r ^= *r << 17
	return uint64(*r)
}

func main() {
	var a int64 = 3037000500
	fmt.Println(a * a)

	var t int64 = 1577934245000000000
	t += 1
	fmt.Println(t, t%1000)

	rnd := xorshift(40)
	fmt.Println(rnd.Next(), rnd.Next(), rnd.Next())

	var u uint64 = 5
	fmt.Println(^u, -u)

	var m uint64 = 1<<64 - 1
	fmt.Println(m)

	minA, minB := int64(math.MinInt64), int64(-1)
	fmt.Println(minA / minB)

	xs := []int{10, 20, 30}
	fmt.Println(xs[int64(1)])

	x := int64(1<<40 + 5)
	fmt.Println(int32(x))

	y := int64(1<<53 + 1)
	fmt.Println(float64(y))

	divZero := func() {
		defer func() { fmt.Println(recover()) }()
		var z int64
		_ = int64(1) / z
	}
	divZero()

	negShift := func() {
		defer func() { fmt.Println(recover()) }()
		n := -1
		_ = int64(1) << n
	}
	negShift()
}
`;
	await assertProgramOutput(
		src,
		"-9223372036709301616\n1577934245000000001 1\n43290790440 9226231805932350012 13632027486628815208\n18446744073709551610 18446744073709551611\n18446744073709551615\n-9223372036854775808\n20\n5\n9.007199254740992e+15\nruntime error: integer divide by zero\nruntime error: negative shift amount\n",
	);
});

// ── Narrow shifts and float32 on js packages ──────────────────

section("Narrow shift panics and float32 rounding");

test("negative shift count panics for narrow integers", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func try(name string, f func()) {
	defer func() { fmt.Println(name, recover()) }()
	f()
}

func main() {
	n := -1
	try("int32", func() { var x int32 = 5; _ = x << n })
	try("int16", func() { var x int16 = 5; _ = x << n })
	try("int8", func() { var x int8 = 5; _ = x >> n })
	try("uint8", func() { var x uint8 = 5; _ = x << n })
	try("uint16", func() { var x uint16 = 5; _ = x >> n })
	try("uint32", func() { var x uint32 = 5; _ = x << n })
}
`,
		"int32 runtime error: negative shift amount\nint16 runtime error: negative shift amount\nint8 runtime error: negative shift amount\nuint8 runtime error: negative shift amount\nuint16 runtime error: negative shift amount\nuint32 runtime error: negative shift amount\n",
	);
});

test("float32 division rounds in a js package", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	a := float32(1)
	b := float32(3)
	fmt.Println(a / b)
	c := a / b
	c += 0.1
	fmt.Println(c)
}
`,
		"0.33333334\n0.43333334\n",
	);
});

test("64-bit / and % evaluate operands once", async () => {
	for (const t of ["int64", "uint64"]) {
		await assertAllTargetsOutput(
			`package main

import "fmt"

func main() {
	count := 0
	f := func() ${t} { count++; return 2 }
	_ = ${t}(10) / f()
	fmt.Println(count)
	_ = ${t}(10) % f()
	fmt.Println(count)
	g := func() ${t} { count++; return 10 }
	_ = g() / ${t}(3)
	_ = g() % ${t}(3)
	fmt.Println(count)
}
`,
			"1\n2\n4\n",
		);
	}
});

test("untyped constant shifted by a variable in 64-bit context", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	k := uint(3)
	var m uint64 = (1 << k) - 1
	var n uint64 = 5
	fmt.Println(n & m)
	var a int64 = 1 << k
	fmt.Println(a, int64(1)<<k)
	var b int64 = (1 << k) + 1
	fmt.Println(b)
}
`,
		"5\n8 8\n9\n",
	);
});

section("uint subtraction and local constants in 64-bit shifts");

test("uint subtraction wraps below zero in both packages", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	var n uint = 3
	fmt.Println(n-64 > 100)
	var m uint = 5
	m -= 9
	fmt.Println(m > 100)
	var a uint = 7
	fmt.Println(a&3-5 > 100, 10-a&3 < 100)
}
`,
		"true\ntrue\ntrue true\n",
	);
});

test("a function-local untyped constant shifted into a uint64 is exact", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	var b uint64 = 1
	var e uint = 3
	const half = 1 << 51
	b += half >> e
	fmt.Println(b)
}
`,
		"281474976710657\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
