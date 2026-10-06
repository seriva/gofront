// GoFront test suite — JS strict numeric mode for 'both' packages

import {
	assertContains,
	assertEqual,
	assertThrows,
	compile,
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
	assertContains(js, "o.In.F = Math.fround(o.In.F + 0.1)");
	// float32 accumulation differs from float64; int8 wraps; uint8 wraps; index evaluated once.
	assertEqual(runJs(js), "1.0000001192092896 0.10000000149011612 -128 0 1");
});
