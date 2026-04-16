// GoFront test suite — operators, literals, semantic differences

import { fileURLToPath } from "node:url";
import {
	assert,
	assertContains,
	assertEqual,
	assertErrorContains,
	compile,
	runJs,
	section,
	test,
} from "../helpers.js";

section("Unimplemented Go features");

test("go statement produces a clear error", () => {
	let threw = false;
	try {
		compile(`package main
func main() {
	go doSomething()
}`);
	} catch (e) {
		threw = true;
		assertContains(e.message, "goroutines are not supported");
	}
	assert(threw, "expected parse error for go statement");
});

test("select statement produces a clear error", () => {
	let threw = false;
	try {
		compile(`package main
func main() {
	select {
	}
}`);
	} catch (e) {
		threw = true;
		assertContains(e.message, "select statement is not supported");
	}
	assert(threw, "expected parse error for select statement");
});

test("chan type produces a clear error", () => {
	let threw = false;
	try {
		compile(`package main
func main() {
	var ch chan int
	_ = ch
}`);
	} catch (e) {
		threw = true;
		assertContains(e.message, "channels are not supported");
	}
	assert(threw, "expected parse error for chan type");
});

test("make(chan int) produces a clear error", () => {
	let threw = false;
	try {
		compile(`package main
func main() {
	ch := make(chan int)
	_ = ch
}`);
	} catch (e) {
		threw = true;
		assertContains(e.message, "channels are not supported");
	}
	assert(threw, "expected parse error for chan in make");
});

// ═════════════════════════════════════════════════════════════
// Bit clear operator &^
// ═════════════════════════════════════════════════════════════

section("Bit clear operator &^");

test("&^ clears bits", () => {
	const { js } = compile(`package main
func main() {
	a := 0xFF
	b := a &^ 0x0F
	println(b)
}`);
	const out = runJs(js);
	assertEqual(out.trim(), "240");
});

test("&^ in expression", () => {
	const { js } = compile(`package main
func main() {
	x := 6 &^ 3
	println(x)
}`);
	const out = runJs(js);
	assertEqual(out.trim(), "4");
});

// ═════════════════════════════════════════════════════════════
// Numeric literal formats
// ═════════════════════════════════════════════════════════════

section("Numeric literal formats");

test("numeric separator 1_000_000", () => {
	const { js } = compile(`package main
func main() {
	n := 1_000_000
	println(n)
}`);
	const out = runJs(js);
	assertEqual(out.trim(), "1000000");
});

test("binary literal 0b1010", () => {
	const { js } = compile(`package main
func main() {
	n := 0b1010
	println(n)
}`);
	const out = runJs(js);
	assertEqual(out.trim(), "10");
});

test("octal literal 0o777", () => {
	const { js } = compile(`package main
func main() {
	n := 0o777
	println(n)
}`);
	const out = runJs(js);
	assertEqual(out.trim(), "511");
});

test("hex literal 0xFF", () => {
	const { js } = compile(`package main
func main() {
	n := 0xFF
	println(n)
}`);
	const out = runJs(js);
	assertEqual(out.trim(), "255");
});

test("binary with separators 0b1111_0000", () => {
	const { js } = compile(`package main
func main() {
	n := 0b1111_0000
	println(n)
}`);
	const out = runJs(js);
	assertEqual(out.trim(), "240");
});

// ═════════════════════════════════════════════════════════════
// Fallthrough in type switch
// ═════════════════════════════════════════════════════════════

section("Fallthrough in type switch");

test("fallthrough in type switch is a type error", () => {
	const { errors } = compile(`package main
func main() {
	var x any = 42
	switch x.(type) {
	case int:
		println("int")
		fallthrough
	case string:
		println("string")
	}
}`);
	assertErrorContains(errors, "cannot fallthrough in type switch");
});

test("fallthrough in regular switch is still allowed", () => {
	const { js, errors } = compile(`package main
func main() {
	x := 1
	switch x {
	case 1:
		println("one")
		fallthrough
	case 2:
		println("two")
	}
}`);
	assertEqual(errors.length, 0);
	const out = runJs(js);
	assertContains(out, "one");
	assertContains(out, "two");
});

// ═════════════════════════════════════════════════════════════
// string(int) → Unicode code point
// ═════════════════════════════════════════════════════════════

section("string(int) conversion");

test("string(65) produces 'A'", () => {
	const { js } = compile(`package main
func main() {
	s := string(65)
	println(s)
}`);
	const out = runJs(js);
	assertEqual(out.trim(), "A");
});

test("string(9731) produces snowman ☃", () => {
	const { js } = compile(`package main
func main() {
	s := string(9731)
	println(s)
}`);
	const out = runJs(js);
	assertEqual(out.trim(), "☃");
});

test("string(str) still uses String()", () => {
	const { js } = compile(`package main
func main() {
	x := 42
	s := string(x)
	println(s)
}`);
	assertContains(js, "String.fromCodePoint");
	const out = runJs(js);
	assertEqual(out.trim(), "*");
});

// ═════════════════════════════════════════════════════════════
// Three-index slice expressions
// ═════════════════════════════════════════════════════════════

section("Three-index slice expressions");

test("s[1:3:5] compiles and slices correctly", () => {
	const { js } = compile(`package main
func main() {
	s := []int{10, 20, 30, 40, 50}
	t := s[1:3:5]
	println(len(t))
	println(t[0])
	println(t[1])
}`);
	const out = runJs(js);
	const lines = out.trim().split("\n");
	assertEqual(lines[0], "2");
	assertEqual(lines[1], "20");
	assertEqual(lines[2], "30");
});

test("three-index slice type checks max index", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{1, 2, 3}
	t := s[0:1:2]
	println(t[0])
}`);
	assertEqual(errors.length, 0);
	const out = runJs(js);
	assertEqual(out.trim(), "1");
});

// ═════════════════════════════════════════════════════════════
// Hex float literals
// ═════════════════════════════════════════════════════════════

section("Hex float literals");

test("0x1p10 equals 1024", () => {
	const { js } = compile(`package main
func main() {
	n := 0x1p10
	println(n)
}`);
	const out = runJs(js);
	assertEqual(out.trim(), "1024");
});

test("0x1.8p1 equals 3", () => {
	const { js } = compile(`package main
func main() {
	n := 0x1.8p1
	println(n)
}`);
	const out = runJs(js);
	assertEqual(out.trim(), "3");
});

test("0xAp-2 equals 2.5", () => {
	const { js } = compile(`package main
func main() {
	n := 0xAp-2
	println(n)
}`);
	const out = runJs(js);
	assertEqual(out.trim(), "2.5");
});

// ═════════════════════════════════════════════════════════════
// Anonymous struct types
// ═════════════════════════════════════════════════════════════

section("Anonymous struct types");

test("anonymous struct composite literal", () => {
	const { js } = compile(`package main
func main() {
	x := struct { Name string; Age int }{Name: "Alice", Age: 30}
	println(x.Name)
	println(x.Age)
}`);
	const out = runJs(js);
	assertEqual(out.trim(), "Alice\n30");
});

test("var with anonymous struct type produces zero-value object", () => {
	const { js } = compile(`package main
func main() {
	var x struct { Name string; Active bool }
	println(x.Name)
	println(x.Active)
}`);
	const out = runJs(js);
	assertContains(out, "false");
	// Name is "" (empty string), Active is false
	assertEqual(out, "\nfalse");
});

test("anonymous struct field assignment", () => {
	const { js } = compile(`package main
func main() {
	var x struct { Val int }
	x.Val = 42
	println(x.Val)
}`);
	const out = runJs(js);
	assertEqual(out.trim(), "42");
});

test("anonymous struct as function return type", () => {
	const { js, errors } = compile(`package main
func newPoint() struct { X int; Y int } {
	return struct { X int; Y int }{X: 10, Y: 20}
}
func main() {
	p := newPoint()
	println(p.X)
	println(p.Y)
}`);
	assertEqual(errors.length, 0);
	const out = runJs(js);
	assertEqual(out.trim(), "10\n20");
});

// ═════════════════════════════════════════════════════════════
// Semantic differences from Go
// ═════════════════════════════════════════════════════════════
// These tests explicitly encode GoFront behaviour that intentionally diverges
// from the Go specification. Each test documents the difference so regressions
// are caught immediately.

section("Semantic differences — string len() and range");

test("len() on string returns JS character count, not Go byte count", () => {
	// Go: len("héllo") == 6 (UTF-8 bytes: h=1, é=2, l=1, l=1, o=1)
	// GoFront: len("héllo") == 5 (JS string .length, UTF-16 code units)
	const { js, errors } = compile(`package main
func main() {
	s := "héllo"
	println(len(s))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js).trim(), "5");
});

test("len() on emoji string returns JS character count", () => {
	// Go: len("😀") == 4 (4 UTF-8 bytes)
	// GoFront: len("😀") depends on JS — emoji is a surrogate pair so .length == 2
	const { js, errors } = compile(`package main
func main() {
	s := "😀"
	println(len(s))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js).trim(), "2");
});

test("range over multi-byte string yields sequential indices, not byte offsets", () => {
	// Go: for i, ch := range "héllo" → indices 0, 1, 3, 4, 5 (byte offsets; é is 2 bytes)
	// GoFront: indices are 0, 1, 2, 3, 4 (JS character positions)
	const { js, errors } = compile(`package main
func main() {
	result := ""
	for i, _ := range "héllo" {
		if result != "" {
			result += ","
		}
		result += fmt.Sprintf("%d", i)
	}
	println(result)
}`);
	assertEqual(errors.length, 0);
	// GoFront: sequential 0,1,2,3,4 — Go would produce 0,1,3,4,5
	assertEqual(runJs(js).trim(), "0,1,2,3,4");
});

section("Semantic differences — fixed-size arrays");

test("[n]T array is a plain JS array with no size enforcement", () => {
	// Go: [3]int has exactly 3 elements, always. You cannot append to it.
	// GoFront: [3]int compiles to a plain JS array. len() returns 3, but
	// there is no runtime enforcement of the size. The array is mutable.
	const { js, errors } = compile(`package main
func main() {
	arr := [3]int{10, 20, 30}
	println(len(arr))
	println(arr[0])
	println(arr[1])
	println(arr[2])
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js).trim(), "3\n10\n20\n30");
	// Verify the generated JS is a plain array literal, not a fixed-length wrapper
	assertContains(js, "[10, 20, 30]");
});

section("Semantic differences — type assertions");

test("plain type assertion on wrong type panics at runtime", () => {
	// Go: x.(int) on a string value panics at runtime.
	// GoFront: plain (non-comma-ok) type assertion now panics (matching Go).
	const { js, errors } = compile(`package main
func main() {
	var x any = "hello"
	v := x.(int)
	println(v)
}`);
	assertEqual(errors.length, 0);
	// Should throw — the assertion fails at runtime
	let threw = false;
	try {
		runJs(js);
	} catch (_e) {
		threw = true;
	}
	assert(threw, "expected plain type assertion to panic on type mismatch");
});

test("comma-ok type assertion on wrong type returns false safely", () => {
	// Both Go and GoFront: comma-ok form does not panic.
	// GoFront now matches Go: v is set to the zero value of T on failure.
	const { js, errors } = compile(`package main
func main() {
	var x any = "hello"
	v, ok := x.(int)
	println(v, ok)
}`);
	assertEqual(errors.length, 0);
	const out = runJs(js);
	assertContains(out, "0 false");
});

// ── for range string yields rune integers ────────────────────

section("for range string yields rune integers");

test("range string value is rune integer (code point)", () => {
	const { js, errors } = compile(`package main
func main() {
  for _, r := range "AB" {
    println(r)
  }
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "65\n66");
});

test("rune arithmetic works in range loop", () => {
	const { js, errors } = compile(`package main
func main() {
  for _, r := range "AB" {
    println(r + 1)
  }
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "66\n67");
});

test("rune comparison works in range loop", () => {
	const { js, errors } = compile(`package main
func main() {
  for _, r := range "AB" {
    println(r == 65)
  }
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("range string index-only loop still works", () => {
	const { js, errors } = compile(`package main
func main() {
  for i := range "abc" {
    println(i)
  }
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0\n1\n2");
});

test("string(r) converts rune back to character in range loop", () => {
	const { js, errors } = compile(`package main
func main() {
  for _, r := range "AB" {
    println(string(r))
  }
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "A\nB");
});

test("switch string(r) over range string matches character cases", () => {
	const { js, errors } = compile(`package main
func main() {
  out := ""
  for _, r := range "a<b&c" {
    switch string(r) {
    case "<":
      out = out + "[lt]"
    case "&":
      out = out + "[amp]"
    default:
      out = out + string(r)
    }
  }
  println(out)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "a[lt]b[amp]c");
});

// ── Multi-value function forwarding f(g()) ───────────────────

section("Multi-value function forwarding f(g())");

test("f(g()) forwards two-return values to function taking two params", () => {
	const { js, errors } = compile(`package main
func split(s string) (string, string) {
  return "hello", "world"
}
func join(a string, b string) string {
  return a + " " + b
}
func main() {
  println(join(split("hello world")))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello world");
});

test("multi-value forward in assignment also works", () => {
	const { js, errors } = compile(`package main
func pair() (int, int) { return 3, 4 }
func add(a int, b int) int { return a + b }
func main() {
  println(add(pair()))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "7");
});

// ── Entry point ───────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
