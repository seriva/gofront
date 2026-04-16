// GoFront test suite — type system and type checking

import { fileURLToPath } from "node:url";
import {
	assert,
	assertEqual,
	assertErrorContains,
	compile,
	runJs,
	section,
	summarize,
	test,
} from "./helpers.js";

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

// ═════════════════════════════════════════════════════════════
// Scoping and closures
// ═════════════════════════════════════════════════════════════

section("New type checks");

test("break outside loop and switch is an error", () => {
	const { errors } = compile(`package main
func main() {
  break
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "break");
});

test("continue outside loop is an error", () => {
	const { errors } = compile(`package main
func main() {
  continue
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "continue");
});

test("fallthrough outside switch is an error", () => {
	const { errors } = compile(`package main
func main() {
  fallthrough
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "fallthrough");
});

test("break inside for loop is valid", () => {
	const { errors } = compile(`package main
func main() {
  for i := 0; i < 3; i++ {
    break
  }
}`);
	assertEqual(errors.length, 0);
});

test("break inside switch is valid", () => {
	const { errors } = compile(`package main
func main() {
  x := 1
  switch x {
  case 1:
    break
  }
}`);
	assertEqual(errors.length, 0);
});

test("continue inside for loop is valid", () => {
	const { errors } = compile(`package main
func main() {
  for i := 0; i < 3; i++ {
    continue
  }
}`);
	assertEqual(errors.length, 0);
});

test("labeled continue outside loop is an error", () => {
	const { errors } = compile(`package main
func main() {
MyLabel:
  continue MyLabel
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "continue");
});

test("labeled break outside loop and switch is an error", () => {
	const { errors } = compile(`package main
func main() {
MyLabel:
  break MyLabel
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "break");
});

test("reassigning a const is an error", () => {
	const { errors } = compile(`package main
const MaxSize = 10
func main() {
  MaxSize = 20
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "const");
});

test("reassigning a local const is an error", () => {
	const { errors } = compile(`package main
func main() {
  const x = 5
  x = 10
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "const");
});

test("shadowing a const with a var in inner scope is allowed", () => {
	// In Go, shadowing a const with a var in a child scope is valid
	const { errors } = compile(`package main
const x = 5
func main() {
  x := 10
  console.log(x)
}`);
	assertEqual(errors.length, 0);
});

// ═════════════════════════════════════════════════════════════

section("Sized integer types");

test("uint is accepted as a type", () => {
	const js = compile(`package main
func main() {
	var x uint = 42
	console.log(x)
}`).js;
	assertEqual(runJs(js), "42");
});

test("int32 is accepted as a type", () => {
	const js = compile(`package main
func main() {
	var x int32 = 100
	console.log(x)
}`).js;
	assertEqual(runJs(js), "100");
});

test("float32 is accepted as a type", () => {
	const js = compile(`package main
func main() {
	var x float32 = 3.14
	console.log(x)
}`).js;
	assertEqual(runJs(js), "3.14");
});

test("uint64 used in function signature", () => {
	const js = compile(`package main
func double(n uint64) uint64 {
	return n * 2
}
func main() {
	console.log(double(21))
}`).js;
	assertEqual(runJs(js), "42");
});

test("int8, int16, int64 all accepted", () => {
	const js = compile(`package main
func main() {
	var a int8 = 1
	var b int16 = 2
	var c int64 = 3
	console.log(a + b + c)
}`).js;
	assertEqual(runJs(js), "6");
});

// ── Struct tags ───────────────────────────────────────────────

section("Type switch");

test("type switch dispatches on int", () => {
	const js = compile(`package main
func describe(x any) string {
	switch x.(type) {
	case int:
		return "int"
	case string:
		return "string"
	case bool:
		return "bool"
	default:
		return "other"
	}
}
func main() {
	console.log(describe(42))
	console.log(describe("hi"))
	console.log(describe(true))
}`).js;
	assertEqual(runJs(js), "int\nstring\nbool");
});

test("type switch with binding variable", () => {
	const js = compile(`package main
func double(x any) any {
	switch v := x.(type) {
	case int:
		return v * 2
	case string:
		return v + v
	default:
		return v
	}
}
func main() {
	console.log(double(21))
	console.log(double("ab"))
}`).js;
	assertEqual(runJs(js), "42\nabab");
});

test("type switch default branch", () => {
	const js = compile(`package main
func classify(x any) string {
	switch x.(type) {
	case int:
		return "number"
	default:
		return "unknown"
	}
}
func main() {
	console.log(classify([]int{1, 2}))
}`).js;
	assertEqual(runJs(js), "unknown");
});

test("type switch case nil", () => {
	const js = compile(`package main
func isNil(x any) bool {
	switch x.(type) {
	case nil:
		return true
	default:
		return false
	}
}
func main() {
	console.log(isNil(nil))
	console.log(isNil(1))
}`).js;
	assertEqual(runJs(js), "true\nfalse");
});

test("type switch multi-type case", () => {
	const js = compile(`package main
func isNumeric(x any) bool {
	switch x.(type) {
	case int, float64:
		return true
	default:
		return false
	}
}
func main() {
	console.log(isNumeric(1))
	console.log(isNumeric(3.14))
	console.log(isNumeric("x"))
}`).js;
	assertEqual(runJs(js), "true\ntrue\nfalse");
});

test("type switch on struct type", () => {
	const js = compile(`package main
type Dog struct { name string }
type Cat struct { name string }
func speak(x any) string {
	switch x.(type) {
	case Dog:
		return "woof"
	case Cat:
		return "meow"
	default:
		return "..."
	}
}
func main() {
	console.log(speak(Dog{name: "Rex"}))
	console.log(speak(Cat{name: "Mew"}))
	console.log(speak(42))
}`).js;
	assertEqual(runJs(js), "woof\nmeow\n...");
});

test("type switch without default falls through silently", () => {
	const js = compile(`package main
func main() {
	var x any = "hello"
	switch x.(type) {
	case int:
		console.log("int")
	case bool:
		console.log("bool")
	}
	console.log("done")
}`).js;
	assertEqual(runJs(js), "done");
});

test("type switch binding var used in case body", () => {
	const js = compile(`package main
func process(x any) int {
	switch v := x.(type) {
	case int:
		return v + 10
	default:
		console.log(v)
		return 0
	}
}
func main() {
	console.log(process(5))
	console.log(process("s"))
}`).js;
	assertEqual(runJs(js), "15\ns\n0");
});

// ── []byte / []rune conversions ───────────────────────────────

section("Sized integer types — type safety");

test("passing string to uint param is a type error", () => {
	const { errors } = compile(`package main
func f(n uint) { console.log(n) }
func main() { f("oops") }`);
	assertErrorContains(errors, "Cannot assign untyped string to int");
});

test("uint return type mismatch caught", () => {
	const { errors } = compile(`package main
func f() uint { return "bad" }`);
	assertErrorContains(errors, "Cannot assign untyped string to int");
});

test("uintptr accepted as type annotation", () => {
	const js = compile(`package main
func main() {
	var p uintptr = 1024
	console.log(p)
}`).js;
	assertEqual(runJs(js), "1024");
});

// ── Struct tags — edge cases ──────────────────────────────────

section("Interface embedding");

test("embedded interface — methods flattened for satisfaction", () => {
	const { js, errors } = compile(`package main
type Reader interface { Read() string }
type Writer interface { Write(s string) }
type ReadWriter interface {
	Reader
	Writer
}
type File struct { Name string }
func (f File) Read() string { return "data" }
func (f File) Write(s string) { console.log(s) }
func process(rw ReadWriter) { console.log(rw.Read()) }
func main() { process(File{Name: "test.txt"}) }`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "data");
});

test("embedded interface — struct missing embedded method fails", () => {
	const { errors } = compile(`package main
type Reader interface { Read() string }
type ReadWriter interface {
	Reader
	Write(s string)
}
type Broken struct {}
func (b Broken) Write(s string) {}
func process(rw ReadWriter) {}
func main() { process(Broken{}) }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "does not implement");
});

test("embedded interface — own methods plus embedded", () => {
	const { js, errors } = compile(`package main
type Stringer interface { String() string }
type Formatter interface {
	Stringer
	Format() string
}
type Doc struct { Title string }
func (d Doc) String() string { return d.Title }
func (d Doc) Format() string { return "[" + d.Title + "]" }
func show(f Formatter) { console.log(f.Format()) }
func main() { show(Doc{Title: "README"}) }`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "[README]");
});

test("embedded interface — multiple embeds composed", () => {
	const { js, errors } = compile(`package main
type A interface { MethodA() string }
type B interface { MethodB() string }
type C interface { MethodC() string }
type ABC interface {
	A
	B
	C
}
type Impl struct {}
func (i Impl) MethodA() string { return "a" }
func (i Impl) MethodB() string { return "b" }
func (i Impl) MethodC() string { return "c" }
func use(x ABC) { console.log(x.MethodA(), x.MethodB(), x.MethodC()) }
func main() { use(Impl{}) }`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "a b c");
});

test("embedded interface — diamond embedding (shared method)", () => {
	const { js, errors } = compile(`package main
type Base interface { Name() string }
type Left interface { Base }
type Right interface { Base }
type Both interface {
	Left
	Right
}
type Thing struct {}
func (t Thing) Name() string { return "thing" }
func show(b Both) { console.log(b.Name()) }
func main() { show(Thing{}) }`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "thing");
});

test("embedding non-interface type is an error", () => {
	const { errors } = compile(`package main
type Point struct { X int; Y int }
type Bad interface {
	Point
}
func main() {}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "cannot embed non-interface type");
});

// ═════════════════════════════════════════════════════════════
// Additional coverage
// ═════════════════════════════════════════════════════════════

section("Type errors — condition and operator checks");

test("if condition must be bool — non-bool raises error", () => {
	const { errors } = compile(`package main
func main() {
	x := 42
	if x { console.log("bad") }
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "bool");
});

test("for condition must be bool — non-bool raises error", () => {
	const { errors } = compile(`package main
func main() {
	x := 1
	for x {
		break
	}
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "bool");
});

test("invalid binary op — string minus string is an error", () => {
	const { errors } = compile(`package main
func main() {
	s := "hello" - "world"
	console.log(s)
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Invalid operation");
});

test("no new variables on left side of := is an error", () => {
	const { errors } = compile(`package main
func main() {
	x := 1
	x := 2
	console.log(x)
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "no new variables");
});

test("cannot index a bool value", () => {
	const { errors } = compile(`package main
func main() {
	b := true
	console.log(b[0])
}`);
	assert(errors.length > 0, "expected error");
});

test("cannot slice an int value", () => {
	const { errors } = compile(`package main
func main() {
	n := 42
	console.log(n[1:3])
}`);
	assert(errors.length > 0, "expected error");
});

// ═════════════════════════════════════════════════════════════
// dts-parser unit tests
// ═════════════════════════════════════════════════════════════

section("TypeChecker — error messages");

test("missing return value in non-void function is an error", () => {
	const { errors } = compile(`package main
func greet() string {
	return
}
func main() { console.log(greet()) }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Missing return value");
});

test("type error message includes array type notation [3]int", () => {
	const { errors } = compile(`package main
func f(a [3]int) {}
func main() { f("hello") }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "[3]int");
});

test("type error message includes map type notation", () => {
	const { errors } = compile(`package main
func f(m map[string]int) {}
func main() { f("hello") }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "map[string]int");
});

test("positional struct initialization type-checks elements", () => {
	// GoFront processes non-KV elements in a struct composite lit — just ensure no crash
	const { errors } = compile(`package main
type Point struct { X int; Y int }
func main() {
	p := Point{1, 2}
	console.log(p.X)
}`);
	assert(errors !== undefined);
});

// ═════════════════════════════════════════════════════════════
// CodeGen — new(T) for basic types
// ═════════════════════════════════════════════════════════════

section("new(T) for basic types");

test("new(int) zero value is 0", () => {
	const js = compile(`package main
func main() {
	p := new(int)
	console.log(p.value)
}`).js;
	assertEqual(runJs(js), "0");
});

test("new(string) zero value is empty string", () => {
	const js = compile(`package main
func main() {
	p := new(string)
	console.log(p.value)
}`).js;
	assertEqual(runJs(js), "");
});

test("new(bool) zero value is false", () => {
	const js = compile(`package main
func main() {
	p := new(bool)
	console.log(p.value)
}`).js;
	assertEqual(runJs(js), "false");
});

test("new(float64) zero value is 0", () => {
	const js = compile(`package main
func main() {
	p := new(float64)
	console.log(p.value)
}`).js;
	assertEqual(runJs(js), "0");
});

// ═════════════════════════════════════════════════════════════
// CodeGen — type conversions
// ═════════════════════════════════════════════════════════════

section("Type conversions");

test("bool(x) converts non-zero int to true", () => {
	const js = compile(`package main
func main() {
	console.log(bool(1))
	console.log(bool(0))
}`).js;
	assertEqual(runJs(js), "true\nfalse");
});

test("[]int(slice) generic slice conversion", () => {
	// []int conversion of a non-string value — exercises the generic Array.from path
	const js = compile(`package main
func main() {
	src := []int{1, 2, 3}
	dst := []int(src)
	console.log(len(dst))
	console.log(dst[0])
}`).js;
	assertEqual(runJs(js), "3\n1");
});

// ═════════════════════════════════════════════════════════════
// Type assertion — comma-ok with error type
// ═════════════════════════════════════════════════════════════

section("Type assertion — error type");

test("type assert comma-ok on error type — string value is true", () => {
	const js = compile(`package main
func main() {
	var x any = "some error"
	_, ok := x.(error)
	console.log(ok)
}`).js;
	assertEqual(runJs(js), "true");
});

test("type assert comma-ok on error type — non-string value is false", () => {
	const js = compile(`package main
func main() {
	var x any = 42
	_, ok := x.(error)
	console.log(ok)
}`).js;
	assertEqual(runJs(js), "false");
});

// ═════════════════════════════════════════════════════════════
// Lexer — tab escape in strings
// ═════════════════════════════════════════════════════════════

section("TypeChecker — pointer type field access");

test("new(T) returns a pointer whose .value is the zero value of T", () => {
	const js = compile(`package main
func main() {
	p := new(int)
	q := new(string)
	r := new(bool)
	console.log(p.value)
	console.log(q.value)
	console.log(r.value)
}`).js;
	assertEqual(runJs(js), "0\n\nfalse");
});

test("arrays have correct string representation in error messages", () => {
	// [3]int should appear as [3]int, not [object Object]int
	const { errors } = compile(`package main
func f(a [3]int) {}
func main() { f("hello") }`);
	assert(errors.length > 0, "expected type error");
	assertErrorContains(errors, "[3]int");
});

// ═════════════════════════════════════════════════════════════
// TypeChecker — make() with various types
// ═════════════════════════════════════════════════════════════

section("TypeChecker — make and new builtins");

test("make(map[string]int) compiles and runs", () => {
	const js = compile(`package main
func main() {
	m := make(map[string]int)
	m["a"] = 1
	console.log(m["a"])
}`).js;
	assertEqual(runJs(js), "1");
});

test("new(struct) zero-initialises all fields", () => {
	const js = compile(`package main
type Point struct { X int; Y int }
func main() {
	p := new(Point)
	console.log(p.value.X)
	console.log(p.value.Y)
}`).js;
	assertEqual(runJs(js), "0\n0");
});

// ── Unused variable detection ─────────────────────────────────

section("Unused variables");

test("unused := variable is an error", () => {
	const { errors } = compile(`package main
func main() {
  x := 1
}`);
	assertErrorContains(errors, "'x' declared and not used");
});

test("unused var declaration is an error", () => {
	const { errors } = compile(`package main
func main() {
  var x int
}`);
	assertErrorContains(errors, "'x' declared and not used");
});

test("used variable is fine", () => {
	const { js } = compile(`package main
func main() {
  x := 42
  console.log(x)
}`);
	assertEqual(runJs(js), "42");
});

test("blank identifier _ is exempt from unused check", () => {
	const { js } = compile(`package main
func main() {
  _, ok := 1, true
  console.log(ok)
}`);
	assertEqual(runJs(js), "true");
});

test("unused variable in if-init is an error", () => {
	const { errors } = compile(`package main
func main() {
  if x := 1; true {
    console.log("yes")
  }
}`);
	assertErrorContains(errors, "'x' declared and not used");
});

test("used variable in if-init is fine", () => {
	const { js } = compile(`package main
func main() {
  if x := 1; x > 0 {
    console.log("positive")
  }
}`);
	assertEqual(runJs(js), "positive");
});

test("unused variable inside for body is an error", () => {
	const { errors } = compile(`package main
func main() {
  for i := 0; i < 1; i++ {
    y := 99
  }
}`);
	assertErrorContains(errors, "'y' declared and not used");
});

test("function params are not flagged as unused", () => {
	const { js } = compile(`package main
func f(x int) {
  console.log("ok")
}
func main() {
  f(1)
}`);
	assertEqual(runJs(js), "ok");
});

test("unused const is not flagged", () => {
	const { js } = compile(`package main
func main() {
  const c = 42
  console.log("ok")
}`);
	assertEqual(runJs(js), "ok");
});

test("multiple unused variables reported", () => {
	const { errors } = compile(`package main
func main() {
  a := 1
  b := 2
}`);
	assertErrorContains(errors, "'a' declared and not used");
	assertErrorContains(errors, "'b' declared and not used");
});

test("circular type alias does not crash", () => {
	const { errors } = compile(`package main
type A = B
type B = A
func main() {}`);
	assert(errors.length > 0, "expected error for circular type alias");
});

// ── Entry point ───────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
