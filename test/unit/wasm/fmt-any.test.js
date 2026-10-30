// GoFront test suite — fmt on WASM: `any` operands and Stringer/error dispatch.
// Every test runs the program on both backends (compileHybrid checks parity);
// the expected text is what go1.26 prints.

import {
	assertEqual,
	assertWasmProgramOutput,
	compileHybrid,
	compileWasm,
	instantiateWasm,
	section,
	summarize,
	test,
} from "../helpers.js";

function out(body, decls = "", imports = '"fmt"') {
	const src = `package main
import (${imports})
${decls}
func Main() {
${body}
}`;
	return compileHybrid(src).run("Main").output;
}

section("fmt on WASM: any operands");

test("any holding int, string, float, bool and nil", () => {
	const o = out(`
	var a any = 5
	var s any = "hi"
	var f any = 2.5
	var b any = true
	var n any
	fmt.Println(a, s, f, b, n)
	fmt.Println(fmt.Sprint(a), fmt.Sprintf("%v|%d", a, a))`);
	assertEqual(o, "5 hi 2.5 true <nil>\n5 5|5");
});

test("time.Duration prints as a count for %d and as text for %v and %s", () => {
	const o = out(
		`
	d := 1500 * time.Millisecond
	fmt.Println(fmt.Sprintf("%d|%5d|%v|%s", d, d, d, d))`,
		"",
		'"fmt"; "time"',
	);
	assertEqual(o, "1500000000|1500000000|1.5s|1.5s");
});

test("any holding a slice, a map, a struct and a struct pointer", () => {
	const o = out(
		`
	var s any = []int{1, 2}
	var m any = map[string]int{"a": 1}
	var p any = P{3}
	var q any = &P{4}
	fmt.Println(s, m, p, q)`,
		"type P struct{ A int }",
	);
	assertEqual(o, "[1 2] map[a:1] {3} &{4}");
});

test("an interface-typed operand is formatted by its dynamic value", () => {
	const o = out(
		`
	var s fmt.Stringer = Color(1)
	fmt.Println(s)`,
		'type Color int\nfunc (c Color) String() string { return "c" }',
	);
	assertEqual(o, "c");
});

test("Sprintf and Println with a spread []any", () => {
	const o = out(`
	xs := []any{1, "a", 2.5}
	fmt.Println(fmt.Sprintf("%d %s %.1f", xs...))
	fmt.Println(xs...)
	fmt.Print(xs...)
	fmt.Println()`);
	assertEqual(o, "1 a 2.5\n1 a 2.5\n1a2.5");
});

test("a nil spread slice has no operands", () => {
	const o = out(`
	var xs []any
	fmt.Println(xs...)
	fmt.Println(fmt.Sprint(xs...) == "")`);
	assertEqual(o, "\ntrue");
});

test("Sprintf with a nil operand prints <nil>", () => {
	assertEqual(out(`fmt.Println(fmt.Sprintf("%v", nil))`), "<nil>");
});

section("fmt on WASM: Stringer and error dispatch");

const TYPES = `
type Color int
func (c Color) String() string { return "color" }
type Point struct{ X, Y int }
func (p Point) String() string { return fmt.Sprintf("(%d,%d)", p.X, p.Y) }
type Counter struct{ N int }
func (c *Counter) String() string { return fmt.Sprintf("counter=%d", c.N) }
type Plain struct{ N int }
func (c *Plain) String() string { return "plain" }
type MyErr struct{ Code int }
func (e *MyErr) Error() string { return fmt.Sprintf("myerr %d", e.Code) }
`;

test("%v and %s call String, %d keeps the number", () => {
	assertEqual(
		out(`fmt.Printf("%v|%s|%d\\n", Color(3), Color(3), Color(3))`, TYPES),
		"color|color|3",
	);
});

test("a value-receiver String applies to values and pointers", () => {
	assertEqual(
		out(
			`p := Point{1, 2}
	fmt.Println(p, &p)`,
			TYPES,
		),
		"(1,2) (1,2)",
	);
});

test("a pointer-receiver String applies to pointers only", () => {
	assertEqual(
		out(
			`c := Counter{5}
	fmt.Println(c, &c)`,
			TYPES,
		),
		"{5} counter=5",
	);
});

test("String is used inside slices, maps and exported fields", () => {
	assertEqual(
		out(
			`type H struct { C Color; c Color }
	fmt.Println([]Color{1, 2}, map[string]Point{"a": {1, 2}}, H{1, 2})`,
			TYPES,
		),
		"[color color] map[a:(1,2)] {color 2}",
	);
});

test("Error is used for an error value held in any", () => {
	assertEqual(
		out(
			`var e any = &MyErr{7}
	fmt.Println(e, fmt.Errorf("w: %w", &MyErr{8}))`,
			TYPES,
		),
		"myerr 7 w: myerr 8",
	);
});

test("a nil pointer calls a pointer-receiver String", () => {
	assertEqual(
		out(
			`var c *Plain
	var p *Point
	fmt.Println(fmt.Sprint(c), p)`,
			TYPES,
		),
		"plain <nil>",
	);
});

test("a pointer to a named scalar with a value-receiver String", () => {
	assertEqual(
		out(
			`x := Color(1)
	p := &x
	fmt.Println(p, fmt.Sprint(p))`,
			'type Color int\nfunc (c Color) String() string { return "col" }',
		),
		"col col",
	);
});

section("fmt on WASM: Println separators, unsigned values, func values");

test("Println separates empty and space-ended strings like Go", () => {
	assertEqual(out(`fmt.Println("", "|")`), " |");
	assertEqual(out(`fmt.Println(0, "a ", true)`), "0 a  true");
	assertEqual(out(`fmt.Println(2, "", nil)`), "2  <nil>");
	assertEqual(out(`fmt.Println("a", "", "b")`), "a  b");
	assertEqual(out(`fmt.Println("", "", "")`), "  ");
});

test("Println after a partial Print line does not add a space", () => {
	assertEqual(
		out(`fmt.Print("x")
	fmt.Println("a")`),
		"xa",
	);
});

test("Println keeps plain int and string operands on the direct path", () => {
	assertEqual(out(`fmt.Println(1, "a", 2)`), "1 a 2");
	assertEqual(
		out(`fmt.Println(int32(-5), int64(-5), -5, uint8(250), int8(-3))`),
		"-5 -5 -5 250 -3",
	);
});

test("unsigned 32 and 64-bit values print unsigned", () => {
	assertEqual(out(`fmt.Println([1]uint32{3465168386})`), "[3465168386]");
	assertEqual(
		out(
			`fmt.Println(T{}.F(), uint32(3304433030))`,
			`type T struct{}
func (T) F() uint32 { return ^uint32(0) }`,
		),
		"4294967295 3304433030",
	);
	assertEqual(out(`fmt.Println(any(uint64(1<<63)))`), "9223372036854775808");
	assertEqual(
		out(`var u uint = 1 << 63
	fmt.Println(u, []uint{u}, map[uint32]uint64{4000000000: 1 << 63})`),
		"9223372036854775808 [9223372036854775808] map[4000000000:9223372036854775808]",
	);
	assertEqual(
		out(
			`s := S{4000000000, 1 << 63}
	fmt.Println(s, &s)
	fmt.Printf("%+v %d\\n", s, s.A)`,
			`type S struct{ A uint32; B uint64 }`,
		),
		"{4000000000 9223372036854775808} &{4000000000 9223372036854775808}\n{A:4000000000 B:9223372036854775808} 4000000000",
	);
	assertEqual(
		out(`var a any = uint32(4000000000)
	fmt.Println(a, fmt.Sprint(a), fmt.Sprintf("%v|%d", a, a))`),
		"4000000000 4000000000 4000000000|4000000000",
	);
});

test("negating an unsigned 64-bit value wraps on WASM", () => {
	const src = `package main
import "fmt"
func Main() {
	u := uint64(1)
	fmt.Println(-u)
}`;
	const { wasm, stringTable } = compileWasm(src);
	const lines = [];
	const { exports } = instantiateWasm(wasm, {
		stringTable,
		stdout: (m) => lines.push(m),
	});
	exports.Main();
	assertEqual(lines.join("\n"), "18446744073709551615");
});

test("Print takes every result of a multi-value call", () => {
	assertEqual(
		out(
			`fmt.Print(two())
	fmt.Println()`,
			`func two() (int, string) { return 1, "x" }`,
		),
		"1x",
	);
});

test("a pointer to a scalar formats with a stable id per target", () => {
	assertEqual(
		out(`x := 1
	y := 2
	fmt.Println(fmt.Sprintf("%p|%p|%p", &x, &x, &y))`),
		"%!p(*int=0x1)|%!p(*int=0x1)|%!p(*int=0x2)",
	);
});

test("func values print as an address-style value, nil as <nil>", () => {
	assertEqual(out(`fmt.Println(func() {})`), "0x1");
	assertEqual(
		out(`f := func(x int) int { return x }
	var g func()
	fmt.Println(f, g)
	fmt.Println(fmt.Sprint(f))`),
		"0x1 <nil>\n0x1",
	);
});

test("struct map keys print in Go's key order", () => {
	assertEqual(
		out(
			`m := map[K]int{K{2}: 2, K{1}: 3}
	fmt.Println(m)
	n := map[L]int{L{"b", 1}: 2, L{"a", 9}: 3, L{"a", 2}: 4}
	fmt.Println(n)`,
			`type K struct{ A int }
type L struct{ S string; N int }`,
		),
		"map[{1}:3 {2}:2]\nmap[{a 2}:4 {a 9}:3 {b 1}:2]",
	);
});

summarize();

test("fmt prints a struct whose field has a named slice or array type", () => {
	const src = `
package main

import "fmt"

type Colors []int
type Pair [2]int
type Doc struct {
	C Colors
	P Pair
}

func Main() string {
	var a any = &Doc{C: Colors{1, 2}, P: Pair{3, 4}}
	return fmt.Sprint(a)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "&{[1 2] [3 4]}");
	assertEqual(wasmRes, jsRes);
});

section("any: wide integers and typed nil values");

test("64-bit and sized integers, named ints and iter.Seq conversions box into any", async () => {
	await assertWasmProgramOutput(
		`package main

import (
	"fmt"
	"iter"
)

type Color int
type U8 uint8

func main() {
	x := any(uint64(1))
	fmt.Println(x)
	var y any = int64(-3)
	var z any = uint32(7)
	var w any = uint64(1) << 63
	var i8 any = int8(-8)
	var u8 any = uint8(8)
	var u16 any = uint16(16)
	var i16 any = int16(-16)
	var i32 any = int32(-32)
	var f32 any = float32(1.5)
	var r any = 'r'
	var by any = byte('b')
	fmt.Println(y, z, w, i8, u8, u16, i16, i32, f32, r, by)
	fmt.Println(any(Color(1)), any(U8(3)), any(Color(1)) == any(Color(1)), any(Color(1)) == any(1), any(Color(1)) == any(Color(2)))
	fmt.Println(any(uint64(1)) == any(uint64(1)), any(uint64(1)) == any(uint32(1)), any(int64(2)) == any(2))
	m := map[any]int{uint64(1): 1, int64(1): 2, Color(1): 3, 1: 4}
	fmt.Println(len(m), m[uint64(1)], m[int64(1)], m[Color(1)], m[1])
	switch v := x.(type) {
	case uint64:
		fmt.Println("u64", v)
	case int:
		fmt.Println("int")
	}
	if v, ok := x.(uint64); ok {
		fmt.Println(v + 1)
	}
	_, ok := x.(int64)
	fmt.Println(ok)
	f := func(yield func(int) bool) { yield(1) }
	n := 0
	for v := range iter.Seq[int](f) {
		n += v
	}
	fmt.Println(n)
}
`,
		`1
-3 7 9223372036854775808 -8 8 16 -16 -32 1.5 114 98
1 3 true false false
true false false
4 1 2 3 4
u64 1
2
false
1
`,
	);
});

test("a nil map, pointer or func in an interface is not a nil interface", async () => {
	await assertWasmProgramOutput(
		`package main

import "fmt"

type P struct{ X int }
type MyMap map[string]int

type myErr struct{}

func (*myErr) Error() string { return "e" }

func main() {
	var nilMap map[string]int
	var a any = nilMap
	fmt.Println(a == nil, a != nil)
	var nilSlice []int
	var b any = nilSlice
	fmt.Println(b == nil)
	var np *P
	var c any = np
	fmt.Println(c == nil, np == nil)
	var nf func()
	var d any = nf
	fmt.Println(d == nil)
	var nm MyMap
	var e any = nm
	fmt.Println(e == nil)
	var err error
	var ee any = err
	fmt.Println(ee == nil)
	var ep *myErr
	var e2 error = ep
	fmt.Println(e2 == nil, e2 != nil)
	fmt.Println(a, c, d, e)
	switch v := a.(type) {
	case map[string]int:
		fmt.Println("map", v == nil, len(v))
	}
	switch v := c.(type) {
	case *P:
		fmt.Println("ptr", v == nil)
	}
	if m, ok := e.(MyMap); ok {
		fmt.Println("named map", m == nil)
	}
	_, ok := e.(map[string]int)
	fmt.Println(ok)
	if f, ok := d.(func()); ok {
		fmt.Println("func", f == nil)
	}
	a = map[string]int{"k": 1}
	c = &P{4}
	fmt.Println(a.(map[string]int)["k"], c.(*P).X, a == nil, c == nil)
}
`,
		`false true
false
false true
false
false
true
false true
map[] <nil> <nil> map[]
map true 0
ptr true
named map true
false
func true
1 4 false false
`,
	);
});
