// GoFront test suite — declarations, constants, type aliases

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assert,
	assertContains,
	assertEqual,
	assertErrorContains,
	compile,
	compileFile,
	FIXTURES,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

section("New features");

test("init() functions execute before main in order", () => {
	const { js, errors } = compileFile(join(FIXTURES, "init_test.go"));
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "AB");
});

test("short variable re-declaration (:=)", () => {
	const { js, errors } = compileFile(join(FIXTURES, "redecl_test.go"));
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "20 30");
});

test("error messages include filenames", () => {
	const { errors } = compileFile(join(FIXTURES, "type_alias_test.go"));
	assertErrorContains(errors, "type_alias_test.go");
});

test("generated code size - len helper", () => {
	const { js } = compile(`package main
func main() {
    xs := []int{1,2}
    console.log(len(xs))
}`);
	assertContains(js, "__len");
	assertEqual(runJs(js), "2");
});

// ═════════════════════════════════════════════════════════════
// Embedded structs
// ═════════════════════════════════════════════════════════════

section("Variadic spread (...)");

test("append with spread merges two slices", () => {
	const js = compile(`package main
func main() {
	a := []int{1, 2, 3}
	b := []int{4, 5, 6}
	a = append(a, b...)
	console.log(len(a))
}`).js;
	assertEqual(runJs(js), "6");
});

test("append spread of empty slice is a no-op", () => {
	const js = compile(`package main
func main() {
	a := []int{1, 2, 3}
	b := []int{}
	a = append(a, b...)
	console.log(len(a))
}`).js;
	assertEqual(runJs(js), "3");
});

test("append spread into nil slice", () => {
	const js = compile(`package main
func main() {
	var a []int
	b := []int{1, 2, 3}
	a = append(a, b...)
	console.log(len(a))
}`).js;
	assertEqual(runJs(js), "3");
});

test("spread into variadic function", () => {
	const js = compile(`package main
func sum(nums ...int) int {
	total := 0
	for _, n := range nums {
		total += n
	}
	return total
}
func main() {
	nums := []int{1, 2, 3, 4}
	console.log(sum(nums...))
}`).js;
	assertEqual(runJs(js), "10");
});

// ═════════════════════════════════════════════════════════════

section("Labeled break / continue");

test("labeled break exits outer loop", () => {
	const js = compile(`package main
func main() {
	result := 0
Outer:
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			if j == 1 {
				break Outer
			}
			result++
		}
	}
	console.log(result)
}`).js;
	assertEqual(runJs(js), "1");
});

test("labeled break exits for from inside switch", () => {
	const js = compile(`package main
func main() {
	result := 0
Search:
	for i := 0; i < 5; i++ {
		switch i {
		case 3:
			break Search
		default:
			result++
		}
	}
	console.log(result)
}`).js;
	assertEqual(runJs(js), "3");
});

test("labeled continue on for range loop", () => {
	const js = compile(`package main
func main() {
	result := 0
	items := []int{1, 2, 3}
Outer:
	for _, x := range items {
		for _, y := range items {
			if y == 2 {
				continue Outer
			}
			result += x
		}
	}
	console.log(result)
}`).js;
	assertEqual(runJs(js), "6");
});

test("labeled continue skips to outer loop", () => {
	const js = compile(`package main
func main() {
	result := 0
Outer:
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			if j == 1 {
				continue Outer
			}
			result++
		}
	}
	console.log(result)
}`).js;
	assertEqual(runJs(js), "3");
});

// ── Sized integer types ───────────────────────────────────────

section("for-condition loop (while pattern)");

test("for cond {} compiles to while loop", () => {
	const js = compile(`package main
func main() {
	n := 0
	for n < 3 {
		n = n + 1
	}
	console.log(n)
}`).js;
	assertEqual(runJs(js), "3");
});

test("for cond {} with break", () => {
	const js = compile(`package main
func main() {
	i := 0
	for i < 10 {
		if i == 4 { break }
		i = i + 1
	}
	console.log(i)
}`).js;
	assertEqual(runJs(js), "4");
});

// ── print / println builtins ──────────────────────────────────

section("Standalone block statement");

test("standalone block introduces new scope", () => {
	const js = compile(`package main
func main() {
	x := 1
	{
		x := 2
		console.log(x)
	}
	console.log(x)
}`).js;
	assertEqual(runJs(js), "2\n1");
});

// ── Const expression arithmetic ───────────────────────────────

section("Const expression arithmetic");

test("const from arithmetic expression", () => {
	const js = compile(`package main
const Base = 10
const Double = Base * 2
const Offset = Double + 5
func main() {
	console.log(Offset)
}`).js;
	assertEqual(runJs(js), "25");
});

// ── Untyped constants ─────────────────────────────────────────

section("Untyped constants");

test("untyped int const assigns to float64 var", () => {
	const { js, errors } = compile(`package main
const x = 5
func main() {
	var f float64 = x
	console.log(f)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5");
});

test("untyped float const assigns to float64 var", () => {
	const { js, errors } = compile(`package main
const pi = 3.14
func main() {
	var f float64 = pi
	console.log(f)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3.14");
});

test("untyped string const assigns to string var", () => {
	const { js, errors } = compile(`package main
const greeting = "hello"
func main() {
	var s string = greeting
	console.log(s)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello");
});

test("untyped bool const assigns to bool var", () => {
	const { js, errors } = compile(`package main
const yes = true
func main() {
	var b bool = yes
	console.log(b)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("untyped int const in float64 function arg", () => {
	const { js, errors } = compile(`package main
const limit = 100
func compute(f float64) float64 { return f * 2 }
func main() {
	console.log(compute(limit))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "200");
});

test("untyped const arithmetic stays untyped", () => {
	const { js, errors } = compile(`package main
const a = 10
const b = a * 3
const c = b + 5
func main() {
	var f float64 = c
	console.log(f)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "35");
});

test("untyped int + typed int = typed int", () => {
	const { js, errors } = compile(`package main
const offset = 10
func main() {
	var x int = 5
	y := x + offset
	console.log(y)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "15");
});

test("typed const int cannot implicitly assign to float64 param in strict Go", () => {
	// In GoFront, typed int -> float64 is still allowed (existing promotion),
	// but this test documents the behavior: typed const uses declared type
	const { js, errors } = compile(`package main
const x int = 42
func main() {
	var f float64 = x
	console.log(f)
}`);
	// GoFront allows int -> float64 promotion even for typed values
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42");
});

test("untyped float const in arithmetic with int var", () => {
	const { js, errors } = compile(`package main
const scale = 2.5
func main() {
	var n int = 4
	result := float64(n) * scale
	console.log(result)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "10");
});

test(":= materializes untyped to default type", () => {
	const { js, errors } = compile(`package main
const x = 42
func main() {
	y := x
	console.log(y)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42");
});

test("const iota values are untyped", () => {
	const { js, errors } = compile(`package main
const (
	A = iota
	B
	C
)
func main() {
	var f float64 = C
	console.log(f)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "2");
});

test("integer division with untyped int constants uses Math.trunc", () => {
	const { js, errors } = compile(`package main
const a = 7
const b = 2
func main() {
	console.log(a / b)
}`);
	assertEqual(errors.length, 0);
	assert(
		js.includes("Math.trunc"),
		"should use Math.trunc for integer division",
	);
	assertEqual(runJs(js), "3");
});

test("mixed untyped int and float produces float result", () => {
	const { js, errors } = compile(`package main
const i = 10
const f = 2.5
func main() {
	console.log(i + f)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "12.5");
});

test("untyped string const in string concatenation", () => {
	const { js, errors } = compile(`package main
const prefix = "Hello"
func main() {
	var s string = prefix + " World"
	console.log(s)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "Hello World");
});

test("untyped const returned from function", () => {
	const { js, errors } = compile(`package main
const val = 99
func getVal() int { return val }
func main() {
	console.log(getVal())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "99");
});

test("untyped const returned as float64", () => {
	const { js, errors } = compile(`package main
const val = 99
func getVal() float64 { return val }
func main() {
	console.log(getVal())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "99");
});

// ═════════════════════════════════════════════════════════════
// CLI — additional flags
// ═════════════════════════════════════════════════════════════

section("switch with init statement");

test("switch with init; tag compiles and runs", () => {
	const js = compile(`package main
func classify(n int) string {
	switch x := n * 2; {
	case x > 10:
		return "big"
	case x > 4:
		return "medium"
	default:
		return "small"
	}
}
func main() {
	console.log(classify(6))
	console.log(classify(3))
	console.log(classify(1))
}`).js;
	assertEqual(runJs(js), "big\nmedium\nsmall");
});

test("switch init scopes the variable", () => {
	const { errors } = compile(`package main
func main() {
	switch x := 10; x {
	case 10:
		console.log("ten")
	}
	_ = x
}`);
	assertErrorContains(errors, "x");
});

// ═════════════════════════════════════════════════════════════
// fmt.Print and fmt.Printf
// ═════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════
// [...]T array length inference
// ═════════════════════════════════════════════════════════════

section("[...]T array length inference");

test("[...]int{} infers correct length", () => {
	const js = compile(`package main
func main() {
	a := [...]int{10, 20, 30}
	console.log(len(a))
}`).js;
	assertEqual(runJs(js), "3");
});

test("[...]string{} compiles and is iterable", () => {
	const js = compile(`package main
func main() {
	words := [...]string{"go", "front", "js"}
	for _, w := range words {
		console.log(w)
	}
}`).js;
	assertEqual(runJs(js), "go\nfront\njs");
});

test("[...]T{} can be indexed and assigned", () => {
	const js = compile(`package main
func main() {
	a := [...]int{1, 2, 3}
	a[1] = 99
	console.log(a[0], a[1], a[2])
}`).js;
	assertEqual(runJs(js), "1 99 3");
});

test("[...]T{} single element infers length 1", () => {
	const js = compile(`package main
func main() {
	a := [...]bool{true}
	console.log(len(a))
}`).js;
	assertEqual(runJs(js), "1");
});

test("[...]T{} type error on wrong element type", () => {
	const { errors } = compile(`package main
func main() {
	_ = [...]int{1, "bad", 3}
}`);
	assertErrorContains(errors, "string");
});

// ═════════════════════════════════════════════════════════════
// min() / max() builtins
// ═════════════════════════════════════════════════════════════

section("min() / max() builtins");

test("min() returns smallest value", () => {
	const js = compile(`package main
func main() {
	console.log(min(3, 1, 2))
}`).js;
	assertEqual(runJs(js), "1");
});

test("max() returns largest value", () => {
	const js = compile(`package main
func main() {
	console.log(max(3, 1, 2))
}`).js;
	assertEqual(runJs(js), "3");
});

test("min/max with two args", () => {
	const js = compile(`package main
func main() {
	a := 10
	b := 20
	console.log(min(a, b))
	console.log(max(a, b))
}`).js;
	assertEqual(runJs(js), "10\n20");
});

test("min/max with float64", () => {
	const js = compile(`package main
func main() {
	console.log(min(1.5, 2.3, 0.7))
	console.log(max(1.5, 2.3, 0.7))
}`).js;
	assertEqual(runJs(js), "0.7\n2.3");
});

// ═════════════════════════════════════════════════════════════
// clear() builtin
// ═════════════════════════════════════════════════════════════

section("clear() builtin");

test("clear() empties a slice", () => {
	const js = compile(`package main
func main() {
	s := []int{1, 2, 3}
	clear(s)
	console.log(len(s))
}`).js;
	assertEqual(runJs(js), "0");
});

test("clear() empties a map", () => {
	const js = compile(`package main
func main() {
	m := map[string]int{"a": 1, "b": 2}
	clear(m)
	console.log(len(m))
}`).js;
	assertEqual(runJs(js), "0");
});

// ═════════════════════════════════════════════════════════════
// range over integer (Go 1.22)
// ═════════════════════════════════════════════════════════════

section("range over integer");

test("for i := range N iterates 0..N-1", () => {
	const js = compile(`package main
func main() {
	sum := 0
	for i := range 5 {
		sum = sum + i
	}
	console.log(sum)
}`).js;
	assertEqual(runJs(js), "10");
});

test("for range N runs N times (no variable)", () => {
	const js = compile(`package main
func main() {
	count := 0
	for range 3 {
		count = count + 1
	}
	console.log(count)
}`).js;
	assertEqual(runJs(js), "3");
});

test("for i := range variable", () => {
	const js = compile(`package main
func main() {
	n := 4
	sum := 0
	for i := range n {
		sum = sum + i
	}
	console.log(sum)
}`).js;
	assertEqual(runJs(js), "6");
});

test("range over integer does not break variadic range", () => {
	const js = compile(`package main
func sum(ns ...int) int {
	total := 0
	for _, n := range ns { total = total + n }
	return total
}
func main() {
	console.log(sum(1, 2, 3, 4))
}`).js;
	assertEqual(runJs(js), "10");
});

// ═════════════════════════════════════════════════════════════
// Type aliases (type A = B)
// ═════════════════════════════════════════════════════════════

section("Type aliases");

test("type alias is transparent", () => {
	const { js, errors } = compile(`package main
type MyInt = int
func double(n MyInt) MyInt {
	return n * 2
}
func main() {
	x := 5
	console.log(double(x))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "10");
});

test("type alias for string", () => {
	const { js, errors } = compile(`package main
type Name = string
func greet(n Name) string {
	return "Hello, " + n
}
func main() {
	console.log(greet("World"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "Hello, World");
});

test("type alias does not require conversion", () => {
	const { js, errors } = compile(`package main
type MyInt = int
func main() {
	var x MyInt = 5
	var y int = x
	console.log(y)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5");
});

test("type alias for struct", () => {
	const { js, errors } = compile(`package main
type Point struct { X int; Y int }
type Coord = Point
func main() {
	p := Coord{X: 3, Y: 4}
	console.log(p.X, p.Y)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3 4");
});

// ── Grouped type declarations ─────────────────────────────────

section("Grouped type declarations");

test("grouped type with struct and alias", () => {
	const { js, errors } = compile(`package main
type (
	Point struct { X int; Y int }
	Name = string
)
func main() {
	p := Point{X: 1, Y: 2}
	var n Name = "hello"
	console.log(p.X, p.Y, n)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1 2 hello");
});

test("grouped type with interface and structs", () => {
	const { js, errors } = compile(`package main
type (
	Animal interface { Sound() string }
	Dog struct { Name string }
	Cat struct {}
)
func (d Dog) Sound() string { return "woof" }
func (c Cat) Sound() string { return "meow" }
func main() {
	var a Animal = Dog{Name: "Rex"}
	console.log(a.Sound())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "woof");
});

test("grouped type with multiple aliases", () => {
	const { js, errors } = compile(`package main
type (
	MyInt = int
	MyStr = string
	MyBool = bool
)
func main() {
	var x MyInt = 42
	var s MyStr = "go"
	var b MyBool = true
	console.log(x, s, b)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42 go true");
});

test("empty grouped type declaration", () => {
	const { js, errors } = compile(`package main
type ()
func main() { console.log("ok") }`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "ok");
});

test("grouped type inside function body", () => {
	const { js, errors } = compile(`package main
func main() {
	type (
		Pair struct { A int; B int }
		Label = string
	)
	p := Pair{A: 10, B: 20}
	var l Label = "sum"
	console.log(l, p.A + p.B)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "sum 30");
});

// ── Blank identifier in assignments ──────────────────────────

section("Blank identifier in assignments");

test("_ = expr discards value without error", () => {
	const { js, errors } = compile(`package main
func sideEffect() int { return 42 }
func main() {
  _ = sideEffect()
  println("ok")
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "ok");
});

test("_, err = f() discards first return value", () => {
	const { js, errors } = compile(`package main
func twoVals() (int, string) { return 1, "hello" }
func main() {
  var s string
  _, s = twoVals()
  println(s)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello");
});

test("x, _ = f() discards second return value", () => {
	const { js, errors } = compile(`package main
func twoVals() (int, string) { return 7, "discard" }
func main() {
  var n int
  n, _ = twoVals()
  println(n)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "7");
});

// ── Const expression repetition with iota ────────────────────

section("Const expression repetition with iota");

test("repeated iota expression B = iota*2", () => {
	const { js, errors } = compile(`package main
const (
  A = iota * 2
  B
  C
)
func main() {
  println(A, B, C)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0 2 4");
});

test("bit-shift iota pattern", () => {
	const { js, errors } = compile(`package main
const (
  Read   = 1 << iota
  Write
  Exec
)
func main() {
  println(Read, Write, Exec)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1 2 4");
});

test("plain iota (no expression) still works", () => {
	const { js, errors } = compile(`package main
const (
  Zero = iota
  One
  Two
)
func main() {
  println(Zero, One, Two)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0 1 2");
});

// ── Unimplemented Go features ─────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
