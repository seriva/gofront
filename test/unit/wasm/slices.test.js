// test/unit/wasm/slices.test.js
// Tests for Phase 4b: Arrays & Slices in WASM and JS-strict parity.

import {
	assertEqual,
	compileHybrid,
	runWasm,
	section,
	test,
} from "../helpers.js";

section("WASM Slices — Creation, Indexing, and Length/Capacity");

test("Slice creation via make and composite literal with indexing", () => {
	const src = `
package main

func Main() int64 {
	s1 := make([]int64, 4)
	s1[0] = 10
	s1[1] = 20
	s1[2] = 30
	s1[3] = 40

	s2 := []int64{1, 2, 3}
	return s1[0] + s1[1] + s1[2] + s1[3] + s2[0] + s2[1] + s2[2]
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 106n);
	assertEqual(wasmRes, jsRes);
});

test("len and cap on slices and nil slice", () => {
	const src = `
package main

func Main() int64 {
	var nilSlice []int64
	l0 := len(nilSlice)
	c0 := cap(nilSlice)

	s1 := make([]int64, 3)
	l1 := len(s1)
	c1 := cap(s1)

	s2 := []int64{10, 20}
	l2 := len(s2)
	c2 := cap(s2)

	return int64(l0*100000 + c0*10000 + l1*1000 + c1*100 + l2*10 + c2)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// l0=0, c0=0, l1=3, c1=3, l2=2, c2=2 -> 3322
	assertEqual(wasmRes, 3322n);
	assertEqual(wasmRes, jsRes);
});

test("make with length and capacity in WASM", () => {
	const src = `
package main

func Main() int64 {
	s := make([]int64, 3, 8)
	return int64(len(s)*10 + cap(s))
}
`;
	const h = compileHybrid(src);
	const { exports } = runWasm(h.wasm, { stringTable: h.stringTable });
	const wasmRes = exports.Main();
	// len=3, cap=8 -> 38
	assertEqual(wasmRes, 38n);
});

test("Slice compound assignment and inc/dec", () => {
	const src = `
package main

func Main() int64 {
	s := []int64{10, 20, 30}
	s[0] += 5
	s[1] *= 2
	s[2]++
	return s[0] + s[1] + s[2]
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// 15 + 40 + 31 = 86
	assertEqual(wasmRes, 86n);
	assertEqual(wasmRes, jsRes);
});

section("WASM Slices — Sub-slicing & 3-Index Slicing");

test("Sub-slicing shares backing array across mutations", () => {
	const src = `
package main

func Main() int64 {
	s := []int64{10, 20, 30, 40, 50}
	sub := s[1:4] // elements 20, 30, 40
	sub[0] = 999  // mutates s[1]

	return s[1] + sub[1] + int64(len(sub)) + int64(cap(sub))
}
`;
	const h = compileHybrid(src);
	const { exports } = runWasm(h.wasm, { stringTable: h.stringTable });
	const wasmRes = exports.Main();
	// s[1]=999, sub[1]=30, len(sub)=3, cap(sub)=4 -> 999 + 30 + 3 + 4 = 1036
	assertEqual(wasmRes, 1036n);
});

test("3-index slicing caps capacity and triggers reallocation on append", () => {
	const src = `
package main

func Main() int64 {
	s := []int64{1, 2, 3, 4, 5}
	// 3-index slice: sub has len 2 (elements 2, 3), cap 2 (max index 3 - low index 1)
	sub := s[1:3:3]
	l := int64(len(sub))
	c := int64(cap(sub))

	// Appending to sub must reallocate since cap is 2!
	sub2 := append(sub, 999)

	// Original s[3] must remain 4, NOT overwritten!
	return l*1000 + c*100 + s[3]*10 + sub2[2]
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// l=2, c=2, s[3]=4, sub2[2]=999 -> 2000 + 200 + 40 + 999 = 3239
	assertEqual(wasmRes, 3239n);
	assertEqual(wasmRes, jsRes);
});

section("WASM Slices — Append & Growth");

test("append single and multiple elements with capacity doubling", () => {
	const src = `
package main

func Main() int64 {
	var s []int64
	s = append(s, 10)
	s = append(s, 20, 30)
	s = append(s, 40, 50, 60)

	var sum int64
	for i := 0; i < len(s); i++ {
		sum += s[i]
	}
	return sum
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// 10 + 20 + 30 + 40 + 50 + 60 = 210
	assertEqual(wasmRes, 210n);
	assertEqual(wasmRes, jsRes);
});

test("append with slice spread append(s, s2...)", () => {
	const src = `
package main

func Main() int64 {
	a := []int64{1, 2, 3}
	b := []int64{4, 5, 6, 7}
	c := append(a, b...)

	var sum int64
	for i := 0; i < len(c); i++ {
		sum += c[i]
	}
	return sum + int64(len(c))
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// sum = 28, len = 7 -> 35
	assertEqual(wasmRes, 35n);
	assertEqual(wasmRes, jsRes);
});

section("WASM Slices — Copy Built-in");

test("copy between slices and partial copy", () => {
	const src = `
package main

func Main() int64 {
	dst := make([]int64, 3)
	src := []int64{10, 20, 30, 40, 50}
	n := copy(dst, src) // copies 3 elements

	return int64(n)*1000 + dst[0] + dst[1] + dst[2]
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// n=3, dst=[10, 20, 30] -> 3000 + 10 + 20 + 30 = 3060
	assertEqual(wasmRes, 3060n);
	assertEqual(wasmRes, jsRes);
});

section("WASM Slices — Range Loops");

test("for i, v := range slice and for i := range slice", () => {
	const src = `
package main

func Main() int64 {
	s := []int64{10, 20, 30, 40}
	var sumVal int64
	var sumIdx int64

	for i, v := range s {
		sumIdx += int64(i)
		sumVal += v
	}

	var sumOnlyIdx int64
	for i := range s {
		sumOnlyIdx += int64(i)
	}

	return sumVal + sumIdx + sumOnlyIdx
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// sumVal = 100, sumIdx = 0+1+2+3 = 6, sumOnlyIdx = 6 -> 112
	assertEqual(wasmRes, 112n);
	assertEqual(wasmRes, jsRes);
});

test("for range with break and continue", () => {
	const src = `
package main

func Main() int64 {
	s := []int64{1, 2, 3, 4, 5, 6, 7, 8}
	var sum int64

	for _, v := range s {
		if v%2 == 0 {
			continue
		}
		if v > 5 {
			break
		}
		sum += v
	}
	return sum
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// odd numbers: 1, 3, 5 -> sum = 9. 7 > 5 breaks.
	assertEqual(wasmRes, 9n);
	assertEqual(wasmRes, jsRes);
});

test("integer range loop for i := range 5", () => {
	const src = `
package main

func Main() int64 {
	var sum int64
	for i := range 5 {
		sum += int64(i)
	}
	return sum
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// 0 + 1 + 2 + 3 + 4 = 10
	assertEqual(wasmRes, 10n);
	assertEqual(wasmRes, jsRes);
});

section("WASM Fixed Arrays [N]T");

test("Fixed array zero-initialization, mutation, len, and slicing", () => {
	const src = `
package main

func Main() int64 {
	var a [4]int64
	l := int64(len(a))
	c := int64(cap(a))

	a[0] = 100
	a[1] = 200
	a[2] = 300
	a[3] = 400

	// Slicing fixed array creates slice pointing to it
	s := a[1:3]
	s[0] = 888 // mutates a[1]

	return l*10000 + c*1000 + a[1] + s[1]
}
`;
	const h = compileHybrid(src);
	const { exports } = runWasm(h.wasm, { stringTable: h.stringTable });
	const wasmRes = exports.Main();
	// l=4, c=4, a[1]=888, s[1]=300 -> 40000 + 4000 + 888 + 300 = 45188
	assertEqual(wasmRes, 45188n);
});

section("WASM Slices of Structs — Value vs Pointer Semantics");

test("Slice of structs: in-place mutation vs element copy on read", () => {
	const src = `
package main

type Point struct {
	X int64
	Y int64
}

func Main() int64 {
	pts := []Point{
		{X: 1, Y: 2},
		{X: 3, Y: 4},
	}

	// Mutate element in-place
	pts[0].X = 100

	// Read element by value: copy must be independent
	p := pts[0]
	p.X = 999 // must NOT mutate pts[0].X

	return pts[0].X + pts[0].Y + p.X + pts[1].X
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// pts[0].X=100, pts[0].Y=2, p.X=999, pts[1].X=3 -> 100 + 2 + 999 + 3 = 1104
	assertEqual(wasmRes, 1104n);
	assertEqual(wasmRes, jsRes);
});

section("WASM Slices — Bounds Checking Traps");

test("Slice index out of range traps with runtime panic", () => {
	const src = `
package main

func Main() int64 {
	s := []int64{1, 2, 3}
	return s[5]
}
`;
	const h = compileHybrid(src);
	let caught = false;
	try {
		const { exports } = runWasm(h.wasm, { stringTable: h.stringTable });
		exports.Main();
	} catch (e) {
		caught = true;
		assertEqual(e.message.includes("index out of range"), true);
	}
	assertEqual(caught, true);
});

test("Slice bounds out of range traps with runtime panic", () => {
	const src = `
package main

func Main() int64 {
	s := []int64{1, 2, 3}
	sub := s[1:5]
	return sub[0]
}
`;
	const h = compileHybrid(src);
	let caught = false;
	try {
		const { exports } = runWasm(h.wasm, { stringTable: h.stringTable });
		exports.Main();
	} catch (e) {
		caught = true;
		assertEqual(e.message.includes("slice bounds out of range"), true);
	}
	assertEqual(caught, true);
});

section("WASM Slices — Immutable Headers & Nil Semantics (v1.5.1 Task 1)");

test("nil and empty slice semantics parity", () => {
	const src = `
package main

func Main() int64 {
	var nilS []int64
	emptyS := make([]int64, 0)
	litEmptyS := []int64{}

	var score int64
	if nilS == nil { score += 1 }
	if nilS != nil { score += 10 }
	if emptyS == nil { score += 100 }
	if emptyS != nil { score += 1000 }
	if litEmptyS == nil { score += 10000 }
	if litEmptyS != nil { score += 100000 }

	// len and cap
	score += int64(len(nilS) + cap(nilS))
	score += int64(len(emptyS) + cap(emptyS))
	score += int64(len(litEmptyS) + cap(litEmptyS))

	return score
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 101001n);
	assertEqual(wasmRes, jsRes);
});

test("append on nil slice and multiple appends", () => {
	const src = `
package main

func Main() int64 {
	var s1 []int64
	s2 := append(s1, 10)
	s3 := append(s1, 20, 30)

	// Ensure s1 is still nil and uncorrupted
	var isNil int64
	if s1 == nil { isNil = 1 }

	return isNil*10000 + s2[0]*100 + s3[0] + s3[1]
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 11050n);
	assertEqual(wasmRes, jsRes);
});

test("reslice of nil slice produces nil slice", () => {
	const src = `
package main

func Main() int64 {
	var s []int64
	sub := s[:0]
	sub2 := s[0:0]

	var res int64
	if sub == nil { res += 1 }
	if sub2 == nil { res += 10 }
	res += int64(len(sub) + cap(sub) + len(sub2) + cap(sub2))
	return res
}
`;
	const h = compileHybrid(src);
	const { exports } = runWasm(h.wasm, { stringTable: h.stringTable });
	const wasmRes = exports.Main();
	assertEqual(wasmRes, 11n);
});

section(
	"WASM Slices — i32 Bounds Check and Induction Variables (v1.5.1 Task 2)",
);

test("negative dynamic index panics with out of range", () => {
	const src = `
package main

func Main() int64 {
	s := []int64{10, 20, 30}
	idx := -1
	return s[idx]
}
`;
	const h = compileHybrid(src);
	let caught = false;
	try {
		const { exports } = runWasm(h.wasm, { stringTable: h.stringTable });
		exports.Main();
	} catch (e) {
		caught = true;
		assertEqual(e.message.includes("index out of range"), true);
	}
	assertEqual(caught, true);
});

test("index >= 2^32 panics with out of range for slice and string", () => {
	const src = `
package main

func Main(which int64) int64 {
	idx := int64(1) << 33 // 8589934592 > 2^32
	if which == 0 {
		s := []int64{10, 20, 30}
		return s[idx]
	}
	str := "hello world"
	return int64(str[idx])
}
`;
	const h = compileHybrid(src);
	const { exports } = runWasm(h.wasm, { stringTable: h.stringTable });

	let caughtSlice = false;
	try {
		exports.Main(0n);
	} catch (e) {
		caughtSlice = true;
		assertEqual(e.message.includes("index out of range"), true);
	}
	assertEqual(caughtSlice, true);

	let caughtStr = false;
	try {
		exports.Main(1n);
	} catch (e) {
		caughtStr = true;
		assertEqual(e.message.includes("index out of range"), true);
	}
	assertEqual(caughtStr, true);
});

test("loop over 2^31 bound keeps i64 and computes correctly", () => {
	const src = `
package main

func Main() int64 {
	var sum int64
	// Bound is 3000000002 > 2^31 - 1 (2147483647)
	bound := int64(3000000002)
	for i := int64(3000000000); i < bound; i++ {
		sum += i
	}
	return sum
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// 3000000000 + 3000000001 = 6000000001
	assertEqual(wasmRes, 6000000001n);
	assertEqual(wasmRes, jsRes);
});

test("induction variable escaping address-taken keeps i64 and behaves correctly", () => {
	const src = `
package main

func Main() int64 {
	var sum int64
	for i := 0; i < 5; i++ {
		p := &i
		sum += int64(*p)
	}
	return sum
}
`;
	const h = compileHybrid(src);
	const { exports } = runWasm(h.wasm, { stringTable: h.stringTable });
	// 0 + 1 + 2 + 3 + 4 = 10
	assertEqual(exports.Main(), 10n);
});

test("induction variable captured in closure keeps i64 and behaves correctly", () => {
	const src = `
package main

func Main() int64 {
	var sum int64
	for i := 0; i < 4; i++ {
		fn := func() int64 {
			return int64(i)
		}
		sum += fn()
	}
	return sum
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// 0 + 1 + 2 + 3 = 6
	assertEqual(wasmRes, 6n);
	assertEqual(wasmRes, jsRes);
});

test("loop variable mutated in loop body keeps i64 and behaves correctly", () => {
	const src = `
package main

func Main() int64 {
	var sum int64
	for i := 0; i < 10; i++ {
		sum += int64(i)
		i++ // extra step in body
	}
	return sum
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// i visits 0, 2, 4, 6, 8 -> sum = 20
	assertEqual(wasmRes, 20n);
	assertEqual(wasmRes, jsRes);
});

test("narrow-int index expressions that are not locals use the i32 path", () => {
	const src = `
package main

type S struct {
	B  uint8
	I8 int8
	U16 uint16
}

func idx16() int16 { return 3 }

func Main() int64 {
	s := &S{B: 2, I8: 1, U16: 1}
	sl := []int64{1, 2, 3, 4, 5, 6}
	var arr [4]int64
	arr[s.I8+1] = 7
	str := "abc"
	return sl[s.B*2] + sl[idx16()+1] + arr[2] + int64(str[s.U16])
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// sl[4]=5, sl[4]=5, arr[2]=7, 'b'=98 -> 115
	assertEqual(wasmRes, 115n);
	assertEqual(wasmRes, jsRes);
});

test("int32 package global as index and as comparison operand", () => {
	const src = `
package main

var g int32 = 1

func Main() int64 {
	sl := []int64{10, 20, 30}
	g = 2
	if g < 3 {
		return sl[g]
	}
	return -1
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 30n);
	assertEqual(wasmRes, jsRes);
});

test("range loop variables restore shadowed outer bindings", () => {
	const src = `
package main

func Main() int64 {
	i := 100
	v := int64(1000)
	sl := []int64{1, 2, 3}
	for i := range sl {
		_ = i
	}
	for i := range 3 {
		_ = i
	}
	for i, v := range sl {
		_ = i
		_ = v
	}
	return int64(i) + v
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 1100n);
	assertEqual(wasmRes, jsRes);
});

test("induction variable with <= literal bound near MaxInt32 stays i64", () => {
	const src = `
package main

func Main() int64 {
	n := 0
	for i := 2147483646; i <= 2147483647; i++ {
		n++
	}
	return int64(n)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 2n);
	assertEqual(wasmRes, jsRes);
});
