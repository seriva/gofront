// GoFront test suite — JS strict numeric mode for 'both' packages

import {
	assertAllTargetsOutput,
	assertContains,
	assertEqual,
	assertJsProgramOutput,
	assertJsTargetsOutput,
	assertProgramOutput,
	assertThrows,
	compile,
	compileHybrid,
	runJs,
	section,
	test,
} from "../helpers.js";

section("compiler — strict numeric mode codegen");

test("float32 arithmetic generates Math.fround in both packages", () => {
	const src = `//gofront:target both
package mathx

func Add(a, b float32) float32 {
	return a + b
}
`;
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	assertContains(js, "Math.fround(a + b)");
});

test("int32 multiplication generates Math.imul in both packages", () => {
	const src = `//gofront:target both
package mathx

func Mul(a, b int32) int32 {
	return a * b
}
`;
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	assertContains(js, "Math.imul(a, b)");
});

test("int8 arithmetic wraps with sign extension", () => {
	const src = `//gofront:target both
package mathx

func Add(a, b int8) int8 {
	return a + b
}
`;
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	assertContains(js, "<< 24) >> 24");
});

test("uint8 arithmetic wraps with & 0xFF", () => {
	const src = `//gofront:target both
package mathx

func Add(a, b uint8) uint8 {
	return a + b
}
`;
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	assertContains(js, "& 0xFF");
});

test("shifts follow Go semantics (count >= width gives 0)", () => {
	const src = `//gofront:target both
package mathx

func ShiftLeft(a int32, s int32) int32 {
	return a << s
}
`;
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	assertContains(js, ">= 32 ?");
});

section("compiler — strict numeric mode runtime behavior");

test("int8 overflow wraps: int8(127) + 1 == -128", () => {
	const src = `//gofront:target both
package main

func main() {
	var a int8 = 127
	var b int8 = 1
	var c int8 = a + b
	println(c)
}
`;
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	const res = runJs(js);
	assertEqual(res, "-128");
});

test("uint8 overflow wraps: uint8(255) + 1 == 0", () => {
	const src = `//gofront:target both
package main

func main() {
	var a uint8 = 255
	var b uint8 = 1
	var c uint8 = a + b
	println(c)
}
`;
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	const res = runJs(js);
	assertEqual(res, "0");
});

test("int32 shift >= 32 yields 0", () => {
	const src = `//gofront:target both
package main

func main() {
	var a int32 = 1
	var s int32 = 32
	var c int32 = a << s
	println(c)
}
`;
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	const res = runJs(js);
	assertEqual(res, "0");
});

test("strict integer division by zero panics", () => {
	const src = `//gofront:target both
package main

func main() {
	var a int32 = 10
	var b int32 = 0
	println(a / b)
}
`;
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	assertThrows(() => runJs(js), "integer divide by zero");
});

test("strict compound assignment and ++ apply to indexed and nested lvalues", () => {
	const src = `//gofront:target both
package main

type In struct{ F float32 }
type Out struct{ In In }

func idx(calls *int32) int32 {
	*calls++
	return 0
}

func main() {
	s := []float32{0}
	for i := 0; i < 10; i++ {
		s[0] += 0.1
	}
	o := &Out{}
	o.In.F += 0.1
	b := []int8{127}
	b[0]++
	var calls int32
	u := []uint8{255}
	u[idx(&calls)] += 1
	println(s[0], o.In.F, b[0], u[0], calls)
}
`;
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	assertContains(js, "Math.fround(__o1[__k1] + 0.10000000149011612)");
	// `o` is a pointer: strict mode checks it for nil before the field access.
	assertContains(
		js,
		"{ const __o2 = __nilcall(o).In; __o2.F = Math.fround(__o2.F + 0.10000000149011612); }",
	);
	// float32 accumulation differs from float64; int8 wraps; uint8 wraps; index evaluated once.
	assertEqual(runJs(js), "1.0000001192092896 0.10000000149011612 -128 0 1");
});

section("compiler — strict nil-check elision");

const VEC_SRC = `//gofront:target both
package mathx

type Vec3 struct{ X, Y, Z float32 }

func (out *Vec3) TransformMat4(a *Vec3, m [16]float32) *Vec3 {
	x := a.X
	y := a.Y
	z := a.Z
	out.X = m[0]*x + m[4]*y + m[8]*z
	out.Y = m[1]*x + m[5]*y + m[9]*z
	out.Z = a.Z + out.X
	return out
}

func Cond(a *Vec3, ok bool) float32 {
	if ok {
		return a.X
	}
	return a.Y
}

func Reassigned(a *Vec3, b *Vec3) float32 {
	x := a.X
	a = b
	return x + a.Y
}

func (v *Vec3) IsNil() bool { return v == nil }

func (v *Vec3) ZOrZero() float32 {
	if v == nil {
		return 0
	}
	return v.Z
}
`;

function method(js, header) {
	const start = js.indexOf(header);
	return js.slice(start, js.indexOf("\n  }", start));
}

test("receiver alias of this and repeated parameter derefs skip nil checks", () => {
	const { js, errors } = compile(VEC_SRC);
	assertEqual(errors.length, 0);
	const body = method(js, "TransformMat4(a, m) {");
	assertEqual(body.includes("__nilcall(out)"), false);
	assertEqual(body.split("__nilcall(a)").length - 1, 1);
});

test("a deref in a branch does not cover later derefs", () => {
	const { js } = compile(VEC_SRC);
	const body = js.slice(
		js.indexOf("function Cond("),
		js.indexOf("function Reassigned("),
	);
	assertEqual(body.split("__nilcall(a)").length - 1, 2);
});

test("a reassigned parameter keeps all checks", () => {
	const { js } = compile(VEC_SRC);
	const body = js.slice(js.indexOf("function Reassigned("));
	assertEqual(body.split("__nilcall(a)").length - 1, 2);
});

test("a receiver that compares itself to nil keeps its checks", () => {
	const { js } = compile(VEC_SRC);
	assertContains(method(js, "ZOrZero("), "__nilcall(v)");
});

test("a nil argument still panics with Go's message", () => {
	const src = `//gofront:target both
package mathx

import "fmt"

${VEC_SRC.split("package mathx\n")[1]}
func Main() (res string) {
	defer func() {
		if r := recover(); r != nil {
			res = fmt.Sprintf("%v", r)
		}
	}()
	var v Vec3
	var m [16]float32
	v.TransformMat4(nil, m)
	return ""
}
`;
	const res = compileHybrid(src).run("Main");
	const msg =
		"runtime error: invalid memory address or nil pointer dereference";
	assertEqual(res.jsRes, msg);
});

section("compiler — strict operands are evaluated once, left first");

test("strict / % << >> run a call operand once and left to right", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	{
		calls := 0
		next := func() int32 { calls++; return int32(calls + 1) }
		var a int32 = 100
		fmt.Println(a/next(), calls)
	}
	{
		calls := 0
		next := func() int32 { calls++; return int32(calls + 1) }
		var a int32 = 9
		fmt.Println(a%next(), calls)
	}
	{
		calls := 0
		next := func() uint8 { calls++; return uint8(calls + 1) }
		var s uint8 = 1
		fmt.Println(s<<next(), calls)
	}
	{
		calls := 0
		next := func() int8 { calls++; return int8(calls + 1) }
		var a int8 = 100
		fmt.Println(a/next(), calls)
	}
	{
		calls := 0
		next := func() int { calls++; return calls + 1 }
		n := 100
		fmt.Println(n/next(), n%next(), calls)
	}
	{
		calls := 0
		next := func() uint32 { calls++; return uint32(calls + 1) }
		var x uint32 = 1000
		fmt.Println(x>>next(), calls)
	}
	{
		calls := 0
		next := func() int16 { calls++; return int16(calls + 1) }
		var a int16 = 9
		var b uint16 = 750
		fmt.Println(a%next(), b/uint16(next()), calls)
	}
	{
		calls := 0
		next := func() uint { calls++; return uint(calls + 1) }
		var a int32 = -128
		var b int16 = 100
		var c int8 = -64
		var d int32 = 3
		fmt.Println(a>>next(), b>>next(), c>>next(), d<<next(), calls)
	}
	{
		calls := 0
		next := func() uint8 { calls++; return uint8(calls) }
		v := next() << uint(9)
		fmt.Println(v, calls)
	}
	{
		trace := ""
		l := func() int32 { trace += "l"; return 40 }
		r := func() int32 { trace += "r"; return 3 }
		l8 := func() uint8 { trace += "L"; return 64 }
		ru := func() uint { trace += "r"; return 2 }
		_ = l() << uint(r())
		_ = l() / r()
		_ = l() % r()
		_ = l8() >> ru()
		fmt.Println(trace)
	}
}
`,
		`50 1
1 1
4 1
50 1
50 1 2
250 1
1 250 2
-32 12 -4 96 4
0 1
lrlrlrLr
`,
	);
});

test("strict operators without calls keep the unbound form", () => {
	const src = `//gofront:target both
package mathx

func Ops(a, b int32, c uint8, d uint) (int32, int32, uint8, uint8) {
	return a / b, a % b, c << d, c >> d
}
`;
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	assertEqual(js.includes("(__a, __b) =>"), false);
});

test("compound assignment with a call on the right side runs it once", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S struct{ n int32 }

func main() {
	{
		calls := 0
		next := func() int32 { calls++; return int32(calls + 1) }
		var x int32 = 1000
		x /= next()
		var m int32 = 1000
		m %= next()
		var sl int32 = 1
		sl <<= next()
		var sr int32 = 1000
		sr >>= next()
		var y uint8 = 200
		ny := func() uint8 { calls++; return uint8(calls + 1) }
		y /= ny()
		n := 1000
		nn := func() int { calls++; return calls + 1 }
		n /= nn()
		k := 1000
		k %= nn()
		fmt.Println(x, m, sl, sr, y, n, k, calls)
	}
	{
		calls := 0
		next := func() int32 { calls++; return int32(calls + 1) }
		xs := []int32{100, 100}
		s := S{100}
		arr := [2]int32{64, 0}
		xs[1] /= next()
		s.n /= next()
		arr[0] >>= next()
		fmt.Println(xs, s.n, arr, calls)
	}
	{
		calls := 0
		next := func() int32 { calls++; return int32(calls + 1) }
		m := map[string]int32{"a": 100}
		m["a"] /= next()
		fmt.Println(m["a"], calls)
	}
	{
		calls := 0
		next := func() int32 { calls++; return 2 }
		var out []int32
		for i := int32(64); i > 1; i /= next() {
			out = append(out, i)
		}
		fmt.Println(out, calls)
	}
	{
		calls := 0
		next := func() int64 { calls++; return int64(calls + 1) }
		var z int64 = 100
		z /= next()
		fmt.Println(z, calls)
	}
	{
		// compound assignment with a side-effecting target
		calls := 0
		idx := func() int { calls++; return 1 }
		xs := []int32{0, 100}
		xs[idx()] /= 4
		fmt.Println(xs, calls)
	}
}
`,
		`500 1 16 31 33 142 0 7
[100 50] 33 [4 0] 3
50 1
[64 32 16 8 4 2] 6
50 1
[0 25] 1
`,
	);
});

test("compound assignment reads the target after a call on the right side", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

type S struct{ n int32 }

func main() {
	{
		var x int32 = 100
		next := func() int32 { x = 200; return 2 }
		x /= next()
		var y int = 100
		nexty := func() int { y = 200; return 2 }
		y /= nexty()
		fmt.Println(x, y)
	}
	{
		xs := []int32{100}
		next := func() int32 { xs[0] = 200; return 2 }
		xs[0] /= next()
		s := S{100}
		nexts := func() int32 { s.n = 200; return 2 }
		s.n /= nexts()
		fmt.Println(xs, s.n)
	}
	{
		var x int32 = 100
		calls := 0
		next := func() int32 { calls++; x = 8; return 2 }
		var out []int32
		for j := 0; j < 2; x /= next() {
			out = append(out, x)
			j++
		}
		fmt.Println(out, x, calls)
	}
}
`,
		`100 100
[100] 100
[100 4] 4 2
`,
	);
});

test("strict compound %=, <<= and >>= read the target after a call on the right side", async () => {
	await assertJsProgramOutput(
		`package main

import "fmt"

func main() {
	var m int32 = 100
	nextm := func() int32 { m = 205; return 10 }
	m %= nextm()
	var x int32 = 10
	next := func() uint { x = 20; return 1 }
	x <<= next()
	var z int32 = 1000
	nz := func() uint { z = 2000; return 2 }
	z >>= nz()
	fmt.Println(m, x, z)
}
`,
		`5 40 500
`,
	);
});

test("compound assignment on every target reads the target after the right-hand call", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P struct{ n int }

func main() {
	var x int32 = 100
	next := func() int32 { x = 200; return 2 }
	x += next()
	fmt.Println(x)
	x = 100
	x /= next()
	fmt.Println(x)
	x = 100
	x %= next() + 1
	fmt.Println(x)
	x = 100
	shift := func() uint { x = 200; return 2 }
	x <<= shift()
	fmt.Println(x)
	x = 100
	x >>= shift()
	fmt.Println(x)
	y := 100
	ny := func() int { y = 200; return 2 }
	y += ny()
	fmt.Println(y)
	m := map[string]int{"a": 1}
	nm := func() int { m["a"] = 50; return 2 }
	m["a"] += nm()
	fmt.Println(m["a"])
	p := &P{1}
	np := func() int { p.n = 70; return 2 }
	p.n += np()
	fmt.Println(p.n)
}
`,
		`202
100
2
800
50
202
52
72
`,
	);
});

test("a compound assignment without a call emits a plain operator", () => {
	const { js } = compile(`package main
func main() {
	x := 1
	y := 2
	x += y
	println(x)
}`);
	assertContains(js, "x += y;");
});
