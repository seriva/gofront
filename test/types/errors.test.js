// GoFront test suite — type errors and type assertions

import {
	assert,
	assertEqual,
	assertErrorContains,
	compile,
	runJs,
	section,
	test,
} from "../helpers.js";

section("Type errors");

test("undefined variable", () => {
	const { errors } = compile(`package main
func main() { console.log(notDefined) }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "notDefined");
});

test("wrong argument count", () => {
	const { errors } = compile(`package main
func add(a int, b int) int { return a + b }
func main() { add(1) }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "argument");
});

test("too many arguments", () => {
	const { errors } = compile(`package main
func id(x int) int { return x }
func main() { id(1, 2, 3) }`);
	assert(errors.length > 0, "expected error");
});

test("return type mismatch", () => {
	const { errors } = compile(`package main
func getNum() int { return "oops" }`);
	assert(errors.length > 0, "expected error");
});

test("field access on unknown type", () => {
	const { errors } = compile(`package main
type Box struct { W float64 }
func main() {
  b := Box{W: 1.0}
  console.log(b.Height)
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Height");
});

test("calling non-function", () => {
	const { errors } = compile(`package main
func main() {
  x := 42
  x()
}`);
	assert(errors.length > 0, "expected error");
});

test("duplicate function declaration", () => {
	const { errors } = compile(`package main
func foo() {}
func foo() {}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "foo");
});

// ═════════════════════════════════════════════════════════════
// 3. DOM tests (jsdom)
// ═════════════════════════════════════════════════════════════

section("Type error negative tests");

test("field access on int variable", () => {
	const { errors } = compile(`package main
func main() {
  x := 42
  console.log(x.Foo)
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Foo");
});

test("field access on string variable", () => {
	const { errors } = compile(`package main
func main() {
  s := "hello"
  console.log(s.Length)
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Length");
});

test("field access on bool variable", () => {
	const { errors } = compile(`package main
func main() {
  b := true
  console.log(b.Value)
}`);
	assert(errors.length > 0, "expected error");
});

test("field access on slice", () => {
	const { errors } = compile(`package main
func main() {
  xs := []int{1, 2, 3}
  console.log(xs.Missing)
}`);
	assert(errors.length > 0, "expected error");
});

test("type mismatch in assign", () => {
	const { errors } = compile(`package main
func main() {
  var x int = "not an int"
}`);
	assert(errors.length > 0, "expected error");
});

test("wrong return type from function", () => {
	const { errors } = compile(`package main
func name() string {
  return 42
}`);
	assert(errors.length > 0, "expected error");
});

test("calling result of non-function expression", () => {
	const { errors } = compile(`package main
func main() {
  s := "hello"
  s()
}`);
	assert(errors.length > 0, "expected error");
});

test("undefined field on struct", () => {
	const { errors } = compile(`package main
type Rect struct { W int; H int }
func main() {
  r := Rect{W: 10, H: 5}
  console.log(r.Depth)
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Depth");
});

test("wrong number of values in multi-assign", () => {
	const { errors } = compile(`package main
func pair() (int, int) { return 1, 2 }
func main() {
  a, b, c := pair()
}`);
	// either a type error or should compile without crash — must not throw internally
	assert(errors !== undefined);
});

test("defer non-call expression is rejected", () => {
	const { errors } = compile(`package main
func main() {
  defer 42
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "defer");
});

test("error.Error field access on non-error is rejected", () => {
	const { errors } = compile(`package main
func main() {
  x := 42
  console.log(x.Error)
}`);
	assert(errors.length > 0, "expected error");
});

test("wrong argument type to function", () => {
	const { errors } = compile(`package main
func double(n int) int { return n * 2 }
func main() { double("hello") }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Cannot assign");
});

test("wrong field type in struct literal", () => {
	const { errors } = compile(`package main
type Point struct { X int; Y int }
func main() { _ := Point{X: "not an int", Y: 2} }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Cannot assign");
});

test("undefined type in var declaration", () => {
	const { errors } = compile(`package main
func main() { var x Phantom; _ = x }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Phantom");
});

test("undefined type in function parameter", () => {
	const { errors } = compile(`package main
func greet(x Ghost) {}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Ghost");
});

test("calling non-existent method on struct", () => {
	const { errors } = compile(`package main
type Rect struct { W int }
func main() {
  r := Rect{W: 10}
  r.Fly()
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Fly");
});

test("interface not satisfied when method has wrong return type", () => {
	const { errors } = compile(`package main
type Runner interface { Speed() int }
type Dog struct{}
func (d Dog) Speed() string { return "fast" }
func race(r Runner) {}
func main() { race(Dog{}) }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "does not implement");
});

test("assigning wrong type to struct field", () => {
	const { errors } = compile(`package main
type Box struct { Count int }
func main() {
  b := Box{}
  b.Count = "five"
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Cannot assign");
});

test("undefined type in struct field definition", () => {
	const { errors } = compile(`package main
type Widget struct { Child Ghost }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Ghost");
});

// ═════════════════════════════════════════════════════════════
// Edge case tests
// ═════════════════════════════════════════════════════════════

section("Type assertions");

test("type assertion extracts concrete value", () => {
	const { js } = compile(`package main
type Animal interface { Sound() string }
type Dog struct {}
func (d Dog) Sound() string { return "woof" }
func speak(a Animal) string {
  d := a.(Dog)
  return d.Sound()
}
func main() {
  console.log(speak(Dog{}))
}`);
	assertEqual(runJs(js), "woof");
});

test("comma-ok type assertion — success", () => {
	const { js } = compile(`package main
func main() {
  var x any = 42
  n, ok := x.(int)
  console.log(n, ok)
}`);
	assertEqual(runJs(js), "42 true");
});

test("comma-ok type assertion — failure is safe", () => {
	const { js } = compile(`package main
func main() {
  var x any = "hello"
  _, ok := x.(int)
  console.log(ok)
}`);
	assertEqual(runJs(js), "false");
});

test("type assertion on non-interface source is a compile error", () => {
	const { errors } = compile(`package main
func main() {
  x := 42
  _ = x.(string)
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "is not an interface");
});

test("type assertion on interface source is allowed", () => {
	const { js, errors } = compile(`package main
type Animal interface { Sound() string }
type Dog struct {}
func (d Dog) Sound() string { return "woof" }
func main() {
  var a Animal = Dog{}
  d := a.(Dog)
  console.log(d.Sound())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "woof");
});

test("type assertion on any source is allowed", () => {
	const { js, errors } = compile(`package main
func main() {
  var x any = 42
  v := x.(int)
  console.log(v)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42");
});

test("plain type assertion panics on type mismatch", () => {
	const { js, errors } = compile(`package main
func main() {
  var x any = "hello"
  v := x.(int)
  console.log(v)
}`);
	assertEqual(errors.length, 0);
	let threw = false;
	try {
		runJs(js);
	} catch (_e) {
		threw = true;
	}
	assert(threw, "expected plain assertion to panic on type mismatch");
});

test("comma-ok assertion returns zero value on failure", () => {
	const { js, errors } = compile(`package main
func main() {
  var x any = "hello"
  v, ok := x.(int)
  console.log(v, ok)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0 false");
});

test("comma-ok assertion returns value on success", () => {
	const { js, errors } = compile(`package main
func main() {
  var x any = 42
  v, ok := x.(int)
  console.log(v, ok)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42 true");
});

test("comma-ok assertion on struct returns zero on failure", () => {
	const { js, errors } = compile(`package main
type Dog struct { Name string }
func main() {
  var x any = 42
  d, ok := x.(Dog)
  console.log(d, ok)
}`);
	assertEqual(errors.length, 0);
	assert(runJs(js).includes("false"), "expected ok to be false");
});

// ═════════════════════════════════════════════════════════════
// Scoping and closures
// ═════════════════════════════════════════════════════════════
