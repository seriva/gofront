// test/unit/wasm/strings_any.test.js
// Tests for Phase 4c: Strings & Any in WASM and JS-strict parity.

import {
	assertEqual,
	compileHybrid,
	runWasm,
	section,
	test,
} from "../helpers.js";

section("WASM Strings — Literals, Concatenation, and Compound Assign");

test("String literal, concatenation, and compound assignment", () => {
	const src = `
package main

func Main() string {
	a := "hello"
	b := "world"
	res := a + " " + b
	res += "!"
	return res
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "hello world!");
	assertEqual(wasmRes, jsRes);
});

test("Default zero value of string is empty string", () => {
	const src = `
package main

func Main() int64 {
	var s string
	return int64(len(s))
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 0n);
	assertEqual(wasmRes, jsRes);
});

section("WASM Strings — Comparisons");

test("String comparisons ==, !=, <, <=, >, >=", () => {
	const src = `
package main

func Main() int64 {
	a := "apple"
	b := "banana"
	a2 := "app" + "le"

	var r int64
	if a == a2 { r += 1 }
	if a != b  { r += 10 }
	if a < b   { r += 100 }
	if a <= a2 { r += 1000 }
	if b > a   { r += 10000 }
	if b >= a  { r += 100000 }
	return r
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 111111n);
	assertEqual(wasmRes, jsRes);
});

section("WASM Strings — Length and Indexing");

test("String len and byte indexing", () => {
	const src = `
package main

func Main() int64 {
	s := "GoFront"
	l := int64(len(s))
	c0 := int64(s[0]) // 'G' = 71
	c1 := int64(s[1]) // 'o' = 111
	return l*10000 + c0*100 + c1
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// l=7, c0=71, c1=111 -> 70000 + 7100 + 111 = 77211
	assertEqual(wasmRes, 77211n);
	assertEqual(wasmRes, jsRes);
});

test("String index out of range traps with panic", () => {
	const src = `
package main

func Main() int64 {
	s := "abc"
	return int64(s[10])
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

section("WASM Strings — Sub-slicing");

test("String slicing s[low:high]", () => {
	const src = `
package main

func Main() string {
	s := "Hello, World!"
	sub1 := s[0:5]
	sub2 := s[7:12]
	return sub1 + " " + sub2
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "Hello World");
	assertEqual(wasmRes, jsRes);
});

test("String slice bounds out of range traps with panic", () => {
	const src = `
package main

func Main() string {
	s := "hello"
	return s[2:10]
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

section("WASM Strings — Conversions & Range Loops");

test("String conversion from rune and string range loop", () => {
	const src = `
package main

func Main() int64 {
	s := "ABCD"
	var sumRune int64
	var sumIdx int64
	for i, r := range s {
		sumIdx += int64(i)
		sumRune += int64(r)
	}
	// 'A'(65) + 'B'(66) + 'C'(67) + 'D'(68) = 266
	// sumIdx = 0 + 1 + 2 + 3 = 6
	return sumRune + sumIdx
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// 266 + 6 = 272
	assertEqual(wasmRes, 272n);
	assertEqual(wasmRes, jsRes);
});

test("string(codePoint) conversion", () => {
	const src = `
package main

func Main() string {
	a := string(72) // 'H'
	b := string(105) // 'i'
	return a + b
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "Hi");
	assertEqual(wasmRes, jsRes);
});

section("WASM Any — Boxing & Type Assertions");

test("Any holding scalar int64 with type assertion", () => {
	const src = `
package main

func Main() int64 {
	var a any = int64(42)
	v := a.(int64)
	return v + 8
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 50n);
	assertEqual(wasmRes, jsRes);
});

test("Any comma-ok type assertion succeeds and fails cleanly", () => {
	const src = `
package main

func Main() int64 {
	var a any = int64(100)

	v1, ok1 := a.(int64)
	v2, ok2 := a.(string)

	var score int64
	if ok1 { score += v1 }       // +100
	if !ok2 && v2 == "" { score += 50 } // +50
	return score
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 150n);
	assertEqual(wasmRes, jsRes);
});

test("Any type assertion failure traps with panic", () => {
	const src = `
package main

func Main() int64 {
	var a any = "not a number"
	v := a.(int64)
	return v
}
`;
	const h = compileHybrid(src);
	let caught = false;
	try {
		const { exports } = runWasm(h.wasm, { stringTable: h.stringTable });
		exports.Main();
	} catch (e) {
		caught = true;
		assertEqual(e.message.includes("type assertion failed"), true);
	}
	assertEqual(caught, true);
});

test("Any holding string with type assertion", () => {
	const src = `
package main

func Main() string {
	var a any = "hello from any"
	s, ok := a.(string)
	if ok {
		return s + "!"
	}
	return "failed"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "hello from any!");
	assertEqual(wasmRes, jsRes);
});

test("Any holding struct pointer and slice", () => {
	const src = `
package main

type Point struct {
	X int64
	Y int64
}

func Main() int64 {
	pt := &Point{X: 10, Y: 20}
	var a any = pt
	p := a.(*Point)

	s := []int64{100, 200}
	var b any = s
	s2 := b.([]int64)

	return p.X + p.Y + s2[0] + s2[1]
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// 10 + 20 + 100 + 200 = 330
	assertEqual(wasmRes, 330n);
	assertEqual(wasmRes, jsRes);
});

section("WASM Any — Type Switch & Standard Switch");

test("Type switch on any", () => {
	const src = `
package main

type Point struct {
	X int64
}

func Check(x any) int64 {
	switch v := x.(type) {
	case int64:
		return v * 10
	case string:
		return int64(len(v)) * 100
	case *Point:
		return v.X * 1000
	default:
		return -1
	}
}

func Main() int64 {
	r1 := Check(int64(5))       // 50
	r2 := Check("hello")        // 500
	r3 := Check(&Point{X: 7})   // 7000
	r4 := Check(true)           // -1
	return r1 + r2 + r3 + r4
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// 50 + 500 + 7000 - 1 = 7549
	assertEqual(wasmRes, 7549n);
	assertEqual(wasmRes, jsRes);
});

test("Standard value switch and tagless switch", () => {
	const src = `
package main

func Eval(x int64) int64 {
	var r int64
	switch x {
	case 1:
		r = 10
	case 2, 3:
		r = 20
	default:
		r = 99
	}

	switch {
	case x > 5:
		r += 500
	default:
		r += 100
	}
	return r
}

func Main() int64 {
	return Eval(1) + Eval(2) + Eval(10)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// Eval(1) = 10 + 100 = 110
	// Eval(2) = 20 + 100 = 120
	// Eval(10) = 99 + 500 = 599
	// Total = 110 + 120 + 599 = 829
	assertEqual(wasmRes, 829n);
	assertEqual(wasmRes, jsRes);
});
