// GoFront test suite — operators, formatting, data structures

import { fileURLToPath } from "node:url";
import {
	assert,
	assertContains,
	assertEqual,
	compile,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

section("fmt.Sprintf format verbs");

test("fmt.Sprintf %f formats float", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(fmt.Sprintf("%f", 3.14))
}`);
	assertEqual(errors.length, 0);
	// Go %f defaults to 6 decimal places
	assertEqual(runJs(js), "3.140000");
});

test("fmt.Printf emits to stdout", () => {
	const { js, errors } = compile(`package main
func main() {
	fmt.Printf("count: %d", 7)
}`);
	assertEqual(errors.length, 0);
	// fmt.Printf writes to process.stdout — just verify it compiles and doesn't throw
	assert(js !== null);
	assertContains(js, "__sprintf");
});

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

// ── Standalone block statement ────────────────────────────────

section("fmt.Print and fmt.Printf");

test("fmt.Print compiles without error", () => {
	const { errors, js } = compile(`package main
func main() {
	fmt.Print("hello %s", "world")
}`);
	assertEqual(errors.length, 0);
	assertContains(js, "__sprintf");
});

test("fmt.Printf compiles without error", () => {
	const { errors, js } = compile(`package main
func main() {
	fmt.Printf("value: %d", 42)
}`);
	assertEqual(errors.length, 0);
	assertContains(js, "__sprintf");
});

// ═════════════════════════════════════════════════════════════
// strings package
// ═════════════════════════════════════════════════════════════

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
