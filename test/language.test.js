// GoFront test suite — language features

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
} from "./helpers.js";

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

test("range over string yields index and char", () => {
	const { js } = compile(`package main
func main() {
  for i, ch := range "hi!" {
    console.log(i, ch)
  }
}`);
	assertEqual(runJs(js), "0 h\n1 i\n2 !");
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

section("defer and error");

test("defer runs after function body", () => {
	const { js } = compile(`package main
func main() {
  console.log("start")
  defer console.log("deferred")
  console.log("end")
}`);
	assertEqual(runJs(js), "start\nend\ndeferred");
});

test("defer runs in LIFO order", () => {
	const { js } = compile(`package main
func main() {
  defer console.log("first")
  defer console.log("second")
  defer console.log("third")
  console.log("body")
}`);
	assertEqual(runJs(js), "body\nthird\nsecond\nfirst");
});

test("defer inside called function", () => {
	const { js } = compile(`package main
func greet() {
  defer console.log("bye")
  console.log("hello")
}
func main() {
  greet()
  console.log("after")
}`);
	assertEqual(runJs(js), "hello\nbye\nafter");
});

test("defer inside if inside switch case", () => {
	const { js } = compile(`package main
func run() string {
  x := 1
  switch x {
  case 1:
    if true {
      defer console.log("deferred-in-if-in-switch")
    }
    console.log("case-body")
  }
  return "done"
}
func main() {
  result := run()
  console.log(result)
}`);
	assertEqual(runJs(js), "case-body\ndeferred-in-if-in-switch\ndone");
});

test("defer inside for inside switch case", () => {
	const { js } = compile(`package main
func run() {
  x := 1
  switch x {
  case 1:
    for i := 0; i < 1; i++ {
      defer console.log("deferred-in-for-in-switch")
    }
    console.log("after-for")
  }
}
func main() {
  run()
}`);
	assertEqual(runJs(js), "after-for\ndeferred-in-for-in-switch");
});

test("defer inside nested block inside switch case", () => {
	const { js } = compile(`package main
func run() {
  x := 1
  switch x {
  case 1:
    {
      defer console.log("deferred-in-block-in-switch")
    }
    console.log("case-end")
  }
}
func main() {
  run()
}`);
	assertEqual(runJs(js), "case-end\ndeferred-in-block-in-switch");
});

test("defer in closure does not add try/finally to parent", () => {
	// The _hasDefer flag must be scoped to each function body.
	// A defer inside a closure should NOT cause the outer function to emit try/finally.
	const { js } = compile(`package main
func main() {
  fn := func() {
    defer console.log("inner defer")
    console.log("inner body")
  }
  fn()
  console.log("outer done")
}`);
	assertEqual(runJs(js), "inner body\ninner defer\nouter done");
	// Outer function (main) should NOT have __defers — only the closure should
	const mainBody = js.split("function main()")[1];
	const closureStart = mainBody.indexOf("function()");
	const beforeClosure = mainBody.slice(0, closureStart);
	assert(
		!beforeClosure.includes("__defers"),
		"outer function should not have __defers",
	);
});

test("function without defer produces no try/finally wrapper", () => {
	const { js } = compile(`package main
func add(a int, b int) int {
  return a + b
}
func main() {
  console.log(add(1, 2))
}`);
	assertEqual(runJs(js), "3");
	assert(!js.includes("__defers"), "output should not contain __defers");
	assert(!js.includes("try {"), "output should not contain try/finally");
});

test("error() creates an error value", () => {
	const { js } = compile(`package main
func divide(a int, b int) (int, error) {
  if b == 0 {
    return 0, error("division by zero")
  }
  return a / b, nil
}
func main() {
  result, err := divide(10, 2)
  if err == nil {
    console.log(result)
  }
  _, err2 := divide(5, 0)
  if err2 != nil {
    console.log(err2.Error())
  }
}`);
	assertEqual(runJs(js), "5\ndivision by zero");
});

test("error as return type (nil success)", () => {
	const { js } = compile(`package main
func validate(x int) error {
  if x < 0 {
    return error("negative")
  }
  return nil
}
func main() {
  err := validate(5)
  if err == nil {
    console.log("ok")
  }
  err2 := validate(-1)
  if err2 != nil {
    console.log("invalid")
  }
}`);
	assertEqual(runJs(js), "ok\ninvalid");
});

// ═════════════════════════════════════════════════════════════

section("async/await");

test("async function compiles and resolves", () => {
	const { js } = compile(`package main
async func fetchData() string {
  return "hello"
}
async func main() {
  result := await fetchData()
  console.log(result)
}`);
	assertEqual(js !== null, true);
});

test("async function literal", () => {
	const { errors } = compile(`package main
func main() {
  fn := async func() string {
    return "world"
  }
  console.log(fn)
}`);
	assertEqual(errors.length, 0);
});

// ═════════════════════════════════════════════════════════════
// Type error negative tests
// ═════════════════════════════════════════════════════════════

section("Edge cases");

test("empty struct compiles and is usable", () => {
	const { js } = compile(`package main
type Empty struct {}
func main() {
  e := Empty{}
  console.log(e)
}`);
	assertEqual(runJs(js), "[object Object]");
});

test("nil slice has zero length", () => {
	const { js } = compile(`package main
func main() {
  var xs []int
  console.log(len(xs))
}`);
	assertEqual(runJs(js), "0");
});

test("append to nil slice", () => {
	const { js } = compile(`package main
func main() {
  var xs []int
  xs = append(xs, 1)
  xs = append(xs, 2)
  console.log(len(xs))
  console.log(xs[0])
  console.log(xs[1])
}`);
	assertEqual(runJs(js), "2\n1\n2");
});

test("zero value int is 0", () => {
	const { js } = compile(`package main
func main() {
  var n int
  console.log(n)
}`);
	assertEqual(runJs(js), "0");
});

test("zero value string is empty", () => {
	const { js } = compile(`package main
func main() {
  var s string
  console.log(s == "")
}`);
	assertEqual(runJs(js), "true");
});

test("zero value bool is false", () => {
	const { js } = compile(`package main
func main() {
  var b bool
  console.log(b)
}`);
	assertEqual(runJs(js), "false");
});

test("struct zero value fields", () => {
	const { js } = compile(`package main
type Point struct { X int; Y int }
func main() {
  var p Point
  console.log(p.X)
  console.log(p.Y)
}`);
	assertEqual(runJs(js), "0\n0");
});

test("defer runs even when function returns early", () => {
	const { js } = compile(`package main
func check(x int) {
  defer console.log("cleanup")
  if x < 0 {
    console.log("negative")
    return
  }
  console.log("positive")
}
func main() {
  check(-1)
  check(1)
}`);
	assertEqual(runJs(js), "negative\ncleanup\npositive\ncleanup");
});

test("multiple defers in LIFO order with early return", () => {
	const { js } = compile(`package main
func run() {
  defer console.log("a")
  defer console.log("b")
  return
  defer console.log("never")
}
func main() {
  run()
}`);
	assertEqual(runJs(js), "b\na");
});

test("nil error comparison", () => {
	const { js } = compile(`package main
func ok() error { return nil }
func bad() error { return error("boom") }
func main() {
  e1 := ok()
  e2 := bad()
  console.log(e1 == nil)
  console.log(e2 == nil)
  console.log(e2.Error())
}`);
	assertEqual(runJs(js), "true\nfalse\nboom");
});

test("empty switch falls through to default", () => {
	const { js } = compile(`package main
func label(n int) string {
  switch n {
  case 1:
    return "one"
  case 2:
    return "two"
  default:
    return "other"
  }
}
func main() {
  console.log(label(1))
  console.log(label(2))
  console.log(label(99))
}`);
	assertEqual(runJs(js), "one\ntwo\nother");
});

test("map with missing key returns zero value", () => {
	const { js } = compile(`package main
func main() {
  m := map[string]int{"a": 1}
  console.log(m["a"])
  console.log(m["missing"])
}`);
	assertEqual(runJs(js), "1\n0");
});

test("iota in const block", () => {
	const { js } = compile(`package main
const (
  A = iota
  B
  C
)
func main() {
  console.log(A)
  console.log(B)
  console.log(C)
}`);
	assertEqual(runJs(js), "0\n1\n2");
});

test("variadic function receives all args", () => {
	const { js } = compile(`package main
func sum(nums ...int) int {
  total := 0
  for _, n := range nums {
    total += n
  }
  return total
}
func main() {
  console.log(sum(1, 2, 3, 4))
}`);
	assertEqual(runJs(js), "10");
});

// ═════════════════════════════════════════════════════════════
// Example app compilation tests
// ═════════════════════════════════════════════════════════════

section("Scoping and closures");

test("inner scope variable shadows outer", () => {
	const { js } = compile(`package main
func main() {
  x := "outer"
  {
    x := "inner"
    console.log(x)
  }
  console.log(x)
}`);
	assertEqual(runJs(js), "inner\nouter");
});

test("if-init variable scoped to if block", () => {
	const { js } = compile(`package main
func div(a int, b int) (int, bool) {
  if b == 0 { return 0, false }
  return a / b, true
}
func main() {
  if result, ok := div(10, 2); ok {
    console.log(result)
  }
  if result, ok := div(10, 0); !ok {
    console.log("zero division")
    console.log(result)
  }
}`);
	assertEqual(runJs(js), "5\nzero division\n0");
});

test("closure over loop variable via capture", () => {
	const { js } = compile(`package main
func main() {
  fns := []any{}
  for i := 0; i < 3; i++ {
    captured := i
    fns = append(fns, func() int { return captured })
  }
  for _, f := range fns {
    console.log(f())
  }
}`);
	assertEqual(runJs(js), "0\n1\n2");
});

test("nested closures share captured variable", () => {
	const { js } = compile(`package main
func counter() (func(), func() int) {
  n := 0
  inc := func() { n++ }
  get := func() int { return n }
  return inc, get
}
func main() {
  inc, get := counter()
  inc()
  inc()
  inc()
  console.log(get())
}`);
	assertEqual(runJs(js), "3");
});

// ═════════════════════════════════════════════════════════════
// Named returns
// ═════════════════════════════════════════════════════════════

section("Named returns");

test("named return modified before bare return", () => {
	const { js } = compile(`package main
func clamp(n int, lo int, hi int) (result int) {
  result = n
  if result < lo { result = lo }
  if result > hi { result = hi }
  return
}
func main() {
  console.log(clamp(5, 0, 10))
  console.log(clamp(-3, 0, 10))
  console.log(clamp(15, 0, 10))
}`);
	assertEqual(runJs(js), "5\n0\n10");
});

test("named returns in loop accumulation", () => {
	const { js } = compile(`package main
func sum(xs []int) (total int) {
  for _, x := range xs {
    total += x
  }
  return
}
func main() {
  console.log(sum([]int{1, 2, 3, 4, 5}))
}`);
	assertEqual(runJs(js), "15");
});

// ═════════════════════════════════════════════════════════════
// Pointer receivers
// ═════════════════════════════════════════════════════════════

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
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "type_alias_test.go");
});

test("generated code size - len helper", () => {
	const { js } = compile(`package main
func main() {
    xs := []int{1,2}
    console.log(len(xs))
}`);
	assertContains(js, "function __len(a)");
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
	assert(errors.length > 0, "expected x to be out of scope after switch");
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
	assert(errors.length > 0, "expected type error");
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
	// With a type alias, no conversion is needed between alias and original
	const { errors } = compile(`package main
type MyInt = int
func main() {
	var x MyInt = 5
	var y int = x
	console.log(y)
}`);
	assertEqual(errors.length, 0);
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
	const { errors } = compile(`package main
type ()
func main() {}`);
	assertEqual(errors.length, 0);
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

// ── Unimplemented Go features ─────────────────────────────────

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

// ── Entry point ───────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
