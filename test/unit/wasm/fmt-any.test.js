// GoFront test suite — fmt on WASM: `any` operands and Stringer/error dispatch.
// Every test runs the program on both backends (compileHybrid checks parity);
// the expected text is what go1.26 prints.

import {
	assertEqual,
	compileHybrid,
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

summarize();
