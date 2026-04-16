// GoFront test suite — core language features

import { join } from "node:path";
import {
	assert,
	assertEqual,
	assertErrorContains,
	compile,
	FIXTURES,
	runJs,
	section,
	test,
} from "../helpers.js";

section("Language features");

test("integer variables and arithmetic", () => {
	const { js } = compile(`package main
func main() {
  x := 10
  y := 3
  console.log(x + y)
  console.log(x - y)
  console.log(x * y)
}`);
	assertEqual(runJs(js), "13\n7\n30");
});

test("float64 variables and arithmetic", () => {
	const { js } = compile(`package main
func main() {
  a := 1.5
  b := 2.5
  console.log(a + b)
}`);
	assertEqual(runJs(js), "4");
});

test("var declaration with explicit type", () => {
	const { js } = compile(`package main
func main() {
  var msg string = "hello"
  var n int = 7
  console.log(msg)
  console.log(n)
}`);
	assertEqual(runJs(js), "hello\n7");
});

test("boolean operators", () => {
	const { js } = compile(`package main
func main() {
  console.log(true && false)
  console.log(true || false)
  console.log(!true)
}`);
	assertEqual(runJs(js), "false\ntrue\nfalse");
});

test("string concatenation", () => {
	const { js } = compile(`package main
func main() {
  s := "Hello" + ", " + "World!"
  console.log(s)
}`);
	assertEqual(runJs(js), "Hello, World!");
});

test("string conversion from int", () => {
	const { js } = compile(`package main
func main() {
  n := 42
  s := string(n)
  console.log(s)
}`);
	// Go: string(42) → "*" (Unicode code point 42)
	assertEqual(runJs(js), "*");
});

test("if / else if / else", () => {
	const { js } = compile(`package main
func main() {
  x := 5
  if x > 10 {
    console.log("big")
  } else if x > 3 {
    console.log("medium")
  } else {
    console.log("small")
  }
}`);
	assertEqual(runJs(js), "medium");
});

test("if with init statement", () => {
	const { js } = compile(`package main
func div(a float64, b float64) (float64, bool) {
  if b == 0 { return 0, false }
  return a / b, true
}
func main() {
  if result, ok := div(9, 3); ok {
    console.log(result)
  }
}`);
	assertEqual(runJs(js), "3");
});

test("for C-style loop", () => {
	const { js } = compile(`package main
func main() {
  sum := 0
  for i := 1; i <= 5; i++ {
    sum = sum + i
  }
  console.log(sum)
}`);
	assertEqual(runJs(js), "15");
});

test("for with continue and break", () => {
	const { js } = compile(`package main
func main() {
  for i := 0; i < 10; i++ {
    if i == 3 { continue }
    if i == 6 { break }
    console.log(i)
  }
}`);
	assertEqual(runJs(js), "0\n1\n2\n4\n5");
});

test("for range over slice", () => {
	const { js } = compile(`package main
func main() {
  nums := []int{10, 20, 30}
  for i, v := range nums {
    console.log(i, v)
  }
}`);
	assertEqual(runJs(js), "0 10\n1 20\n2 30");
});

test("for range — index only", () => {
	const { js } = compile(`package main
func main() {
  xs := []string{"a", "b", "c"}
  for i := range xs {
    console.log(i)
  }
}`);
	assertEqual(runJs(js), "0\n1\n2");
});

test("for range — blank index", () => {
	const { js } = compile(`package main
func main() {
  xs := []int{5, 6, 7}
  sum := 0
  for _, v := range xs {
    sum = sum + v
  }
  console.log(sum)
}`);
	assertEqual(runJs(js), "18");
});

test("functions and multiple return values", () => {
	const { js } = compile(`package main
func minMax(a int, b int) (int, int) {
  if a < b { return a, b }
  return b, a
}
func main() {
  lo, hi := minMax(7, 3)
  console.log(lo, hi)
}`);
	assertEqual(runJs(js), "3 7");
});

test("recursive function", () => {
	const { js } = compile(`package main
func fib(n int) int {
  if n <= 1 { return n }
  return fib(n-1) + fib(n-2)
}
func main() {
  console.log(fib(10))
}`);
	assertEqual(runJs(js), "55");
});

test("struct creation and field access", () => {
	const { js } = compile(`package main
type Point struct {
  X float64
  Y float64
}
func main() {
  p := Point{X: 3.0, Y: 4.0}
  console.log(p.X)
  console.log(p.Y)
}`);
	assertEqual(runJs(js), "3\n4");
});

test("struct method", () => {
	const { js } = compile(
		`package main
type Point struct { X float64; Y float64 }
func (p Point) Mag() float64 {
  return Math.sqrt(p.X*p.X + p.Y*p.Y)
}
func main() {
  p := Point{X: 3.0, Y: 4.0}
  console.log(p.Mag())
}`,
		{ fromFile: join(FIXTURES, "_dummy.go") },
	);
	assertEqual(runJs(js), "5");
});

test("interface and dispatch", () => {
	const { js } = compile(`package main
type Animal interface { Sound() string }
type Dog struct { Name string }
type Cat struct {}
func (d Dog) Sound() string { return "woof" }
func (c Cat) Sound() string { return "meow" }
func speak(a Animal) { console.log(a.Sound()) }
func main() {
  speak(Dog{Name: "Rex"})
  speak(Cat{})
}`);
	assertEqual(runJs(js), "woof\nmeow");
});

test("closure captures variable", () => {
	const { js } = compile(`package main
func makeCounter() func() int {
  n := 0
  return func() int {
    n = n + 1
    return n
  }
}
func main() {
  c := makeCounter()
  console.log(c())
  console.log(c())
  console.log(c())
}`);
	assertEqual(runJs(js), "1\n2\n3");
});

test("slice append and len", () => {
	const { js } = compile(`package main
func main() {
  xs := []int{1, 2, 3}
  xs = append(xs, 4)
  xs = append(xs, 5)
  console.log(len(xs))
  console.log(xs[4])
}`);
	assertEqual(runJs(js), "5\n5");
});

test("map creation and access", () => {
	const { js } = compile(`package main
func main() {
  m := map[string]int{"a": 1, "b": 2}
  console.log(m["a"])
  console.log(m["b"])
}`);
	assertEqual(runJs(js), "1\n2");
});

test("for range over map", () => {
	const { js } = compile(`package main
func main() {
  m := map[string]int{"x": 10}
  for k, v := range m {
    console.log(k, v)
  }
}`);
	assertEqual(runJs(js), "x 10");
});

test("switch statement", () => {
	const { js } = compile(`package main
func grade(n int) string {
  switch n {
  case 5: return "A"
  case 4: return "B"
  case 3: return "C"
  default: return "F"
  }
}
func main() {
  console.log(grade(5))
  console.log(grade(3))
  console.log(grade(1))
}`);
	assertEqual(runJs(js), "A\nC\nF");
});

test("nil check on slice", () => {
	const { js } = compile(`package main
func main() {
  var xs []int
  if xs == nil {
    console.log("nil")
  }
  xs = append(xs, 1)
  if xs != nil {
    console.log("not nil")
  }
}`);
	assertEqual(runJs(js), "nil\nnot nil");
});

test("nested structs", () => {
	const { js } = compile(`package main
type Address struct { City string }
type Person struct { Name string; Addr Address }
func main() {
  p := Person{Name: "Alice", Addr: Address{City: "Amsterdam"}}
  console.log(p.Name)
  console.log(p.Addr.City)
}`);
	assertEqual(runJs(js), "Alice\nAmsterdam");
});

test("higher-order function", () => {
	const { js } = compile(`package main
func apply(xs []int, f func(v int) int) []int {
  out := []int{}
  for _, v := range xs {
    out = append(out, f(v))
  }
  return out
}
func main() {
  doubled := apply([]int{1, 2, 3}, func(x int) int { return x * 2 })
  for _, v := range doubled {
    console.log(v)
  }
}`);
	assertEqual(runJs(js), "2\n4\n6");
});

// ═════════════════════════════════════════════════════════════
// 2. Type error tests
// ═════════════════════════════════════════════════════════════

section("Additional language features");

test("const declaration", () => {
	const { js } = compile(`package main
const Pi = 3.14159
const Greeting = "hello"
func main() {
  console.log(Pi)
  console.log(Greeting)
}`);
	assertEqual(runJs(js), "3.14159\nhello");
});

test("for {} infinite loop with break", () => {
	const { js } = compile(`package main
func main() {
  i := 0
  for {
    if i >= 3 { break }
    console.log(i)
    i = i + 1
  }
}`);
	assertEqual(runJs(js), "0\n1\n2");
});

test("multi-assign swap", () => {
	const { js } = compile(`package main
func main() {
  a := 1
  b := 2
  a, b = b, a
  console.log(a, b)
}`);
	assertEqual(runJs(js), "2 1");
});

test("slice expression xs[lo:hi]", () => {
	const { js } = compile(`package main
func main() {
  xs := []int{10, 20, 30, 40, 50}
  ys := xs[1:4]
  console.log(len(ys))
  console.log(ys[0])
  console.log(ys[2])
}`);
	assertEqual(runJs(js), "3\n20\n40");
});

test("int() type conversion truncates", () => {
	const { js } = compile(`package main
func main() {
  x := 3.9
  console.log(int(x))
  y := -2.1
  console.log(int(y))
}`);
	assertEqual(runJs(js), "3\n-2");
});

test("float64() type conversion", () => {
	const { js } = compile(`package main
func main() {
  n := 7
  f := float64(n)
  console.log(f)
}`);
	assertEqual(runJs(js), "7");
});

test("unary minus", () => {
	const { js } = compile(`package main
func main() {
  x := 5
  console.log(-x)
  console.log(-3.14)
}`);
	assertEqual(runJs(js), "-5\n-3.14");
});

test("make(map) and delete", () => {
	const { js } = compile(`package main
func main() {
  m := make(map[string]int)
  m["a"] = 1
  m["b"] = 2
  m["c"] = 3
  console.log(len(m))
  delete(m, "b")
  console.log(len(m))
}`);
	assertEqual(runJs(js), "3\n2");
});

test("make([]T, n)", () => {
	const { js } = compile(`package main
func main() {
  xs := make([]int, 4)
  console.log(len(xs))
}`);
	assertEqual(runJs(js), "4");
});

test("len on map uses Object.keys", () => {
	const { js } = compile(`package main
func main() {
  m := map[string]int{"x": 1, "y": 2}
  console.log(len(m))
}`);
	assertEqual(runJs(js), "2");
});

test("package-level var", () => {
	const { js } = compile(`package main
var total int = 0
func add(n int) { total = total + n }
func main() {
  add(10)
  add(5)
  console.log(total)
}`);
	assertEqual(runJs(js), "15");
});

test("variadic function", () => {
	const { js } = compile(`package main
func sum(ns ...int) int {
  total := 0
  for _, n := range ns { total = total + n }
  return total
}
func main() {
  console.log(sum(1, 2, 3, 4))
  console.log(sum(10))
  console.log(sum())
}`);
	assertEqual(runJs(js), "10\n10\n0");
});

test("named return values with bare return", () => {
	const { js } = compile(`package main
func minmax(xs []int) (min int, max int) {
  min = xs[0]
  max = xs[0]
  for _, v := range xs {
    if v < min { min = v }
    if v > max { max = v }
  }
  return
}
func main() {
  lo, hi := minmax([]int{3, 1, 5, 2, 4})
  console.log(lo, hi)
}`);
	assertEqual(runJs(js), "1 5");
});

test("new(T) allocates zero-value struct", () => {
	const { js } = compile(`package main
type Point struct { X float64; Y float64 }
func main() {
  p := new(Point)
  p.X = 3.0
  p.Y = 4.0
  console.log(p.X, p.Y)
}`);
	assertEqual(runJs(js), "3 4");
});

test("multi-assign from multi-return function", () => {
	const { js } = compile(`package main
func swap(a int, b int) (int, int) { return b, a }
func main() {
  x := 10
  y := 20
  x, y = swap(x, y)
  console.log(x, y)
}`);
	assertEqual(runJs(js), "20 10");
});

test("pointer receiver mutates struct", () => {
	const { js } = compile(`package main
type Counter struct { N int }
func (c *Counter) Inc() { c.N = c.N + 1 }
func main() {
  c := Counter{N: 0}
  c.Inc()
  c.Inc()
  c.Inc()
  console.log(c.N)
}`);
	assertEqual(runJs(js), "3");
});

test("iota in const block", () => {
	const { js } = compile(`package main
const (
  Red = iota
  Green
  Blue
)
func main() { console.log(Red, Green, Blue) }`);
	assertEqual(runJs(js), "0 1 2");
});

test("iota with explicit first value", () => {
	const { js } = compile(`package main
const (
  A = iota
  B = iota
  C = iota
)
func main() { console.log(A, B, C) }`);
	assertEqual(runJs(js), "0 1 2");
});

test("map comma-ok — key present", () => {
	const { js } = compile(`package main
func main() {
  m := map[string]int{"x": 99}
  v, ok := m["x"]
  console.log(v, ok)
}`);
	assertEqual(runJs(js), "99 true");
});

test("map comma-ok — key absent", () => {
	const { js } = compile(`package main
func main() {
  m := map[string]int{"x": 99}
  _, ok := m["missing"]
  console.log(ok)
}`);
	assertEqual(runJs(js), "false");
});

test("implicit struct lits in slice literal", () => {
	const { js } = compile(`package main
type Point struct { X float64; Y float64 }
func main() {
  pts := []Point{{X: 1.0, Y: 2.0}, {X: 3.0, Y: 4.0}}
  console.log(pts[0].X, pts[0].Y)
  console.log(pts[1].X, pts[1].Y)
}`);
	assertEqual(runJs(js), "1 2\n3 4");
});

test("implicit struct lits in map literal", () => {
	const { js } = compile(`package main
type Vec struct { X float64; Y float64 }
func main() {
  m := map[string]Vec{"a": {X: 10.0, Y: 20.0}}
  console.log(m["a"].X, m["a"].Y)
}`);
	assertEqual(runJs(js), "10 20");
});

test("range over string yields index and rune (integer code point)", () => {
	// Go spec: iterating a string yields (byte-index, rune) where rune is an integer
	const { js } = compile(`package main
func main() {
  for i, r := range "hi!" {
    console.log(i, r)
  }
}`);
	assertEqual(runJs(js), "0 104\n1 105\n2 33");
});

test("fallthrough in switch", () => {
	const { js } = compile(`package main
func main() {
  switch 1 {
  case 1:
    console.log("one")
    fallthrough
  case 2:
    console.log("two")
  case 3:
    console.log("three")
  }
}`);
	assertEqual(runJs(js), "one\ntwo");
});

// ── Additional type error tests ───────────────────────────────

test("wrong type in var declaration", () => {
	const { errors } = compile(`package main
func main() { var x int = "hello" }`);
	assert(errors.length > 0);
	assertErrorContains(errors, "Cannot assign");
});

test("interface not satisfied on function call", () => {
	const { errors } = compile(`package main
type Speaker interface { Speak() string }
type Rock struct {}
func greet(s Speaker) {}
func main() { greet(Rock{}) }`);
	assert(errors.length > 0);
	assertErrorContains(errors, "does not implement");
});

test("interface satisfied when methods present", () => {
	const { errors } = compile(`package main
type Speaker interface { Speak() string }
type Dog struct {}
func (d Dog) Speak() string { return "woof" }
func greet(s Speaker) {}
func main() { greet(Dog{}) }`);
	assertEqual(errors.length, 0);
});

// ═════════════════════════════════════════════════════════════
// 6. npm package resolver
// ═════════════════════════════════════════════════════════════
