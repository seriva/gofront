// GoFront test suite — JS strict numeric mode for 'both' packages

import {
	assertContains,
	assertEqual,
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
	assertContains(js, "Math.fround(__o1[__k1] + 0.1)");
	// `o` is a pointer: strict mode checks it for nil before the field access.
	assertContains(
		js,
		"{ const __o2 = __nilcall(o).In; __o2.F = Math.fround(__o2.F + 0.1); }",
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
