// GoFront test suite — TypedArray and sized numeric types (Phase 1)

import {
	BASIC_TYPES,
	BYTE,
	FLOAT32,
	FLOAT64,
	INT,
	INT8,
	INT16,
	INT32,
	isTypedArraySlice,
	STRING,
	typedArrayConstructorForElem,
	UINT,
	UINT8,
	UINT16,
	UINT32,
} from "../../../src/typechecker/types.js";
import {
	assert,
	assertEqual,
	assertErrorContains,
	compile,
	runJs,
	section,
	test,
} from "../helpers.js";

section("TypedArrays & Sized Numeric Types (Phase 1)");

test("BASIC_TYPES maps sized types to distinct singletons", () => {
	assertEqual(BASIC_TYPES.float32, FLOAT32);
	assertEqual(BASIC_TYPES.float64, FLOAT64);
	assertEqual(BASIC_TYPES.uint8, UINT8);
	assertEqual(BASIC_TYPES.byte, UINT8);
	assertEqual(BASIC_TYPES.int8, INT8);
	assertEqual(BASIC_TYPES.int16, INT16);
	assertEqual(BASIC_TYPES.uint16, UINT16);
	assertEqual(BASIC_TYPES.int32, INT32);
	assertEqual(BASIC_TYPES.uint32, UINT32);
});

test("typedArrayConstructorForElem maps all sized numeric types", () => {
	assertEqual(typedArrayConstructorForElem(FLOAT32), "Float32Array");
	assertEqual(typedArrayConstructorForElem(FLOAT64), null);
	assertEqual(typedArrayConstructorForElem(UINT8), "Uint8Array");
	assertEqual(typedArrayConstructorForElem(BYTE), "Uint8Array");
	assertEqual(typedArrayConstructorForElem(INT8), "Int8Array");
	assertEqual(typedArrayConstructorForElem(UINT16), "Uint16Array");
	assertEqual(typedArrayConstructorForElem(INT16), "Int16Array");
	assertEqual(typedArrayConstructorForElem(UINT32), "Uint32Array");
	assertEqual(typedArrayConstructorForElem(INT32), "Int32Array");

	// Non-TypedArray types return null
	assertEqual(typedArrayConstructorForElem(INT), null);
	assertEqual(typedArrayConstructorForElem(UINT), null);
	assertEqual(typedArrayConstructorForElem(STRING), null);
	assertEqual(typedArrayConstructorForElem(null), null);
});

test("isTypedArraySlice recognizes only sized numeric slice types", () => {
	const makeSlice = (elem) => ({ kind: "slice", elem });

	assert(isTypedArraySlice(makeSlice(FLOAT32)));
	assert(!isTypedArraySlice(makeSlice(FLOAT64)));
	assert(isTypedArraySlice(makeSlice(UINT8)));
	assert(isTypedArraySlice(makeSlice(BYTE)));
	assert(isTypedArraySlice(makeSlice(INT8)));
	assert(isTypedArraySlice(makeSlice(UINT16)));
	assert(isTypedArraySlice(makeSlice(INT16)));
	assert(isTypedArraySlice(makeSlice(UINT32)));
	assert(isTypedArraySlice(makeSlice(INT32)));

	// Non-TypedArray slices return false
	assert(!isTypedArraySlice(makeSlice(INT)));
	assert(!isTypedArraySlice(makeSlice(UINT)));
	assert(!isTypedArraySlice(makeSlice(STRING)));
	assert(!isTypedArraySlice(FLOAT32));
	assert(!isTypedArraySlice(null));
});

test("type error when assigning []float32 to []float64", () => {
	const { errors } = compile(`package main
func main() {
	var a []float32
	var b []float64 = a
	_ = b
}`);
	assert(errors.length > 0);
	assertErrorContains(errors, "Cannot assign []float32 to []float64");
});

test("type error when assigning []float64 to []float32", () => {
	const { errors } = compile(`package main
func main() {
	var a []float64
	var b []float32 = a
	_ = b
}`);
	assert(errors.length > 0);
	assertErrorContains(errors, "Cannot assign []float64 to []float32");
});

test("type error when assigning []uint8 to []int32", () => {
	const { errors } = compile(`package main
func main() {
	var a []uint8
	var b []int32 = a
	_ = b
}`);
	assert(errors.length > 0);
	assertErrorContains(errors, "Cannot assign []uint8 to []int32");
});

test("type error when assigning []int to []int32", () => {
	const { errors } = compile(`package main
func main() {
	var a []int
	var b []int32 = a
	_ = b
}`);
	assert(errors.length > 0);
	assertErrorContains(errors, "Cannot assign []int to []int32");
});

test("[]byte and []uint8 are interchangeable", () => {
	const { errors } = compile(`package main
func main() {
	var a []byte
	var b []uint8 = a
	var c []byte = b
	_ = c
}`);
	assertEqual(errors.length, 0);
});

test("untyped constants assign cleanly to sized numeric types", () => {
	const { errors } = compile(`package main
func main() {
	var f32 float32 = 1.25
	var f64 float64 = 3.14159
	var u8 uint8 = 255
	var b byte = 128
	var i8 int8 = -12
	var u16 uint16 = 50000
	var i16 int16 = -30000
	var u32 uint32 = 4000000
	var i32 int32 = -2000000
	_ = f32
	_ = f64
	_ = u8
	_ = b
	_ = i8
	_ = u16
	_ = i16
	_ = u32
	_ = i32
}`);
	assertEqual(errors.length, 0);
});

section("First-Class TypedArray Slices & Sub-slicing (Phase 3)");

test("make([]float32, n) emits new Float32Array(n)", () => {
	const { js, errors } = compile(`package main
func main() {
	buf := make([]float32, 16)
	println(len(buf))
}`);
	assertEqual(errors.length, 0);
	assert(
		js.includes("new Float32Array(16)"),
		"should emit new Float32Array(16)",
	);
	assertEqual(runJs(js), "16");
});

test("make([]uint8, n) and make([]byte, n) emit new Uint8Array(n)", () => {
	const { js, errors } = compile(`package main
func main() {
	b1 := make([]uint8, 8)
	b2 := make([]byte, 4)
	println(len(b1), len(b2))
}`);
	assertEqual(errors.length, 0);
	assert(js.includes("new Uint8Array(8)"));
	assert(js.includes("new Uint8Array(4)"));
	assertEqual(runJs(js), "8 4");
});

test("composite literals emit typed array constructors", () => {
	const { js, errors } = compile(`package main
func main() {
	v := []float32{1.5, 2.5, 3.5}
	println(len(v), v[0], v[1], v[2])
}`);
	assertEqual(errors.length, 0);
	assert(js.includes("new Float32Array([1.5, 2.5, 3.5])"));
	assertEqual(runJs(js), "3 1.5 2.5 3.5");
});

test("sub-slicing TypedArray emits .subarray and creates zero-copy mutable view", () => {
	const { js, errors } = compile(`package main
func main() {
	arr := []float32{10, 20, 30, 40}
	sub := arr[1:3]
	println(sub[0], sub[1])
	sub[0] = 99
	println(arr[1])
}`);
	assertEqual(errors.length, 0);
	assert(js.includes(".subarray(1, 3)"), "should emit .subarray(1, 3)");
	assertEqual(runJs(js), "20 30\n99");
});

test("copy(dst, src) works correctly on TypedArrays", () => {
	const { js, errors } = compile(`package main
func main() {
	dst := make([]float32, 2)
	src := []float32{100, 200, 300}
	n := copy(dst, src)
	println(n, dst[0], dst[1])
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "2 100 200");
});

test("append on TypedArrays preserves TypedArray type and contents", () => {
	const { js, errors } = compile(`package main
func main() {
	a := []float32{1.5, 2.5}
	a = append(a, 3.5, 4.5)
	sub := a[1:3]
	println(len(a), a[0], a[1], a[2], a[3], len(sub), sub[0], sub[1])
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "4 1.5 2.5 3.5 4.5 2 2.5 3.5");
});

test("__equal compares TypedArrays element-by-element via slices.Equal", () => {
	const { js, errors } = compile(`package main
import "slices"
func main() {
	a := []float32{1.5, 2.5}
	b := []float32{1.5, 2.5}
	c := []float32{1.5, 3.0}
	println(slices.Equal(a, b))
	println(slices.Equal(a, c))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});
