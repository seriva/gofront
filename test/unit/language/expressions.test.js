// GoFront test suite — operators, literals, semantic differences

import { fileURLToPath } from "node:url";
import {
	assertContains,
	assertEqual,
	assertErrorContains,
	assertThrows,
	compile,
	compileHybrid,
	Lexer,
	Parser,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

section("Unimplemented Go features");

test("go statement produces a clear error", () => {
	assertThrows(
		() =>
			compile(`package main
func main() {
	go doSomething()
}`),
		"goroutines are not supported",
	);
});

test("select statement produces a clear error", () => {
	assertThrows(
		() =>
			compile(`package main
func main() {
	select {
	}
}`),
		"select statement is not supported",
	);
});

test("chan type produces a clear error", () => {
	assertThrows(
		() =>
			compile(`package main
func main() {
	var ch chan int
	_ = ch
}`),
		"channels are not supported",
	);
});

test("make(chan int) produces a clear error", () => {
	assertThrows(
		() =>
			compile(`package main
func main() {
	ch := make(chan int)
	_ = ch
}`),
		"channels are not supported",
	);
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
// Slice expressions
// ═════════════════════════════════════════════════════════════

section("Slice expressions");

test("s[:i] emits slice(0, i) not slice(, i)", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{1, 2, 3, 4, 5}
	i := 3
	t := s[:i]
	println(len(t))
	println(t[0])
	println(t[2])
}`);
	assertEqual(errors.length, 0);
	const out = runJs(js);
	const lines = out.trim().split("\n");
	assertEqual(lines[0], "3");
	assertEqual(lines[1], "1");
	assertEqual(lines[2], "3");
});

test("append(s[:i], s[i+1:]...) delete pattern works", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{10, 20, 30, 40, 50}
	i := 2
	s = append(s[:i], s[i+1:]...)
	println(len(s))
	println(s[0])
	println(s[1])
	println(s[2])
	println(s[3])
}`);
	assertEqual(errors.length, 0);
	const lines = runJs(js).trim().split("\n");
	assertEqual(lines[0], "4");
	assertEqual(lines[1], "10");
	assertEqual(lines[2], "20");
	assertEqual(lines[3], "40");
	assertEqual(lines[4], "50");
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
	assertThrows(() => runJs(js));
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

test("type assertion on a call expression evaluates the call once", () => {
	const { js, errors } = compile(`package main
var calls int
func next() any {
	calls++
	return calls
}
func main() {
	v := next().(int)
	w, ok := next().(int)
	println(v, w, ok, calls)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js).trim(), "1 2 true 2");
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

// ── Composite literals as call arguments ─────────────────────

section("Composite literals as call arguments");

test("[]pkg.Type{...} call argument parses as a composite literal", () => {
	const src = `package main
import "./other"
func main() {
  use([]other.Item{other.Item{N: 1}}, []*other.Item{})
}`;
	const tokens = new Lexer(src, "x.go").tokenize();
	const ast = new Parser(tokens, "x.go", src).parse();
	const call = ast.decls.find((d) => d.kind === "FuncDecl").body.stmts[0].expr;
	assertEqual(call.kind, "CallExpr");
	assertEqual(call.args.length, 2);
	assertEqual(call.args[0].kind, "CompositeLit");
	assertEqual(call.args[1].kind, "CompositeLit");
});

test("[]int{...} and make([]pkg.Type, n) call arguments still parse", () => {
	const { js, errors } = compile(`package main
func sum(xs []int) int {
  t := 0
  for _, x := range xs { t += x }
  return t
}
func main() {
  println(sum([]int{1, 2, 3}), len(make([]int, 4)))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "6 4");
});

// ── Method expressions (Task 0.15) ────────────────────────────

section("Method expressions");

const METHOD_EXPR_TYPES = `
type C struct { N int }
func (c *C) Inc() { c.N++ }
func (c *C) Add(d int) int { c.N += d; return c.N }
func (c C) Get() int { return c.N }
func (c C) Bump() int { c.N += 100; return c.N }
`;

test("(*T).M and T.M as values (parity)", () => {
	const h = compileHybrid(`package main
${METHOD_EXPR_TYPES}
func Main() int {
	inc := (*C).Inc
	get := C.Get
	c := &C{N: 1}
	inc(c)
	inc(c)
	return get(*c)
}`);
	assertEqual(Number(h.run("Main").wasmRes), 3);
});

test("method expressions passed to a function (parity)", () => {
	const h = compileHybrid(`package main
${METHOD_EXPR_TYPES}
func apply(f func(*C), c *C) { f(c) }
func read(f func(C) int, c C) int { return f(c) }
func Main() int {
	c := &C{N: 5}
	apply((*C).Inc, c)
	return read(C.Get, *c)
}`);
	assertEqual(Number(h.run("Main").wasmRes), 6);
});

test("method expressions called with an explicit receiver (parity)", () => {
	const h = compileHybrid(`package main
${METHOD_EXPR_TYPES}
func Main() int {
	c := C{N: 1}
	r := (*C).Add(&c, 10)
	b := C.Bump(c)
	g := (*C).Get(&c)
	return r*10000 + b*10 + g + c.N*0
}`);
	assertEqual(Number(h.run("Main").wasmRes), 111121);
});

test("value-receiver method expression copies its receiver (parity)", () => {
	const h = compileHybrid(`package main
${METHOD_EXPR_TYPES}
func Main() int {
	c := C{N: 1}
	bump := C.Bump
	r := bump(c)
	return r*10 + c.N
}`);
	assertEqual(Number(h.run("Main").wasmRes), 1011);
});

test("method expressions with variadic and multi-value methods (parity)", () => {
	const h = compileHybrid(`package main
type C struct { N int }
func (c *C) Sum(xs ...int) int { for _, x := range xs { c.N += x }; return c.N }
func (c *C) Div(d int) (int, int) { return c.N / d, c.N % d }
func Main() int {
	c := C{N: 1}
	sum := (*C).Sum
	s := sum(&c, 1, 2, 3)
	div := (*C).Div
	q, m := div(&c, 4)
	q2, m2 := (*C).Div(&c, 5)
	return s*1000 + q*100 + m*10 + q2 + m2
}`);
	assertEqual(Number(h.run("Main").wasmRes), 7133);
});

test("method expressions on a generic type (parity)", () => {
	const h = compileHybrid(`package main
type Box[T any] struct { V T }
func (b *Box[T]) Set(v T) { b.V = v }
func (b Box[T]) Get() T { return b.V }
func Main() int {
	set := (*Box[int]).Set
	b := &Box[int]{}
	set(b, 7)
	(*Box[int]).Set(b, (*Box[int]).Get(b)+1)
	get := Box[int].Get
	return get(*b)
}`);
	assertEqual(Number(h.run("Main").wasmRes), 8);
});

test("(*T).M does not report a dereference error", () => {
	const { errors } = compile(`package main
type C struct { N int }
func (c *C) Inc() { c.N++ }
func main() { f := (*C).Inc; c := &C{}; f(c); console.log(c.N) }`);
	assertEqual(errors.map((e) => e.message).join("\n"), "");
});

test("(*p).M on a pointer variable still dereferences", () => {
	const { js, errors } = compile(`package main
type C struct { N int }
func (c C) Get() int { return c.N }
func main() { p := &C{N: 4}; console.log((*p).Get()) }`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "4");
});

test("(*x).M on a non-pointer value is still a dereference error", () => {
	const { errors } = compile(`package main
type C struct { N int }
func (c C) Get() int { return c.N }
func main() { x := C{}; console.log((*x).Get()) }`);
	assertErrorContains(errors, "cannot dereference non-pointer type C");
});

test("a type in value position is an error", () => {
	const decls = `type C struct { n int }
type Box[T any] struct { v T }
func f(p *C) int { return p.n }
func g(b Box[int]) int { return b.v }`;
	for (const body of [
		"return f(*C)",
		"return g(Box[int])",
		"x := *C; _ = x; return 0",
		"x := (*C); _ = x; return 0",
		"x := Box[int]; _ = x; return 0",
	]) {
		const { errors } = compile(`package main
${decls}
func Main() int { ${body} }`);
		assertErrorContains(errors, "is not an expression");
	}
});

test("T.M on a pointer-receiver method is an error", () => {
	const { errors } = compile(`package main
type C struct { n int }
func (c *C) Inc() { c.n++ }
func Main() int { c := C{}; f := C.Inc; f(c); return c.n }`);
	assertErrorContains(
		errors,
		"invalid method expression C.Inc (needs pointer receiver (*C).Inc)",
	);
});

// ── Entry point ───────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
