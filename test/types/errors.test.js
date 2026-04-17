// GoFront test suite — type errors and type assertions

import {
	assert,
	assertEqual,
	assertErrorContains,
	assertThrows,
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
	assertErrorContains(errors, "Too many arguments");
});

test("return type mismatch", () => {
	const { errors } = compile(`package main
func getNum() int { return "oops" }`);
	assertErrorContains(errors, "Cannot assign");
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
	assertErrorContains(errors, "Cannot call non-function");
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
	assertErrorContains(errors, "has no field");
});

test("field access on slice", () => {
	const { errors } = compile(`package main
func main() {
  xs := []int{1, 2, 3}
  console.log(xs.Missing)
}`);
	assertErrorContains(errors, "has no field");
});

test("type mismatch in assign", () => {
	const { errors } = compile(`package main
func main() {
  var x int = "not an int"
}`);
	assertErrorContains(errors, "Cannot assign");
});

test("wrong return type from function", () => {
	const { errors } = compile(`package main
func name() string {
  return 42
}`);
	assertErrorContains(errors, "Cannot assign");
});

test("calling result of non-function expression", () => {
	const { errors } = compile(`package main
func main() {
  s := "hello"
  s()
}`);
	assertErrorContains(errors, "Cannot call non-function");
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
	assertErrorContains(errors, "not used");
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
	assertErrorContains(errors, "has no field");
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
	assertThrows(() => runJs(js));
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

// ═════════════════════════════════════════════════════════════
// Error values — richer error types (v0.0.5)
// ═════════════════════════════════════════════════════════════

section("Error as interface type");

test("error type has Error() method", () => {
	const { js, errors } = compile(`package main
func main() {
  var e error = error("hello")
  console.log(e.Error())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello");
});

test("error is assignable from struct with Error() string", () => {
	const { js, errors } = compile(`package main
type MyErr struct { Msg string }
func (e MyErr) Error() string { return e.Msg }
func main() {
  var e error = MyErr{Msg: "custom"}
  console.log(e.Error())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "custom");
});

test("error is not assignable from struct without Error()", () => {
	const { errors } = compile(`package main
type Plain struct { X int }
func main() {
  var e error = Plain{X: 1}
  _ = e
}`);
	assertErrorContains(errors, "does not implement");
});

test("error return type accepts nil", () => {
	const { js, errors } = compile(`package main
func ok() error { return nil }
func main() {
  e := ok()
  console.log(e == nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("error return type accepts custom error struct", () => {
	const { js, errors } = compile(`package main
type AppErr struct { Code int }
func (e AppErr) Error() string { return "app error" }
func fail() error { return AppErr{Code: 42} }
func main() {
  e := fail()
  console.log(e.Error())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "app error");
});

section("Runtime error objects");

test("error(msg) creates object with .Error() method", () => {
	const { js, errors } = compile(`package main
func main() {
  e := error("bad input")
  console.log(e.Error())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "bad input");
});

test("errors.New(msg) creates object with .Error() method", () => {
	const { js, errors } = compile(`package main
func main() {
  e := errors.New("not found")
  console.log(e.Error())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "not found");
});

test("fmt.Errorf creates error object", () => {
	const { js, errors } = compile(`package main
func main() {
  e := fmt.Errorf("code %d", 42)
  console.log(e.Error())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "code 42");
});

test("error toString() works in string context", () => {
	const { js, errors } = compile(`package main
func main() {
  e := error("oops")
  console.log(fmt.Sprintf("err: %s", e))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "err: oops");
});

test("error comparison with nil works", () => {
	const { js, errors } = compile(`package main
func mayFail(fail bool) error {
  if fail { return error("failed") }
  return nil
}
func main() {
  e1 := mayFail(false)
  e2 := mayFail(true)
  console.log(e1 == nil)
  console.log(e2 == nil)
  console.log(e2 != nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse\ntrue");
});

section("Custom error types");

test("struct with Error() string satisfies error interface", () => {
	const { js, errors } = compile(`package main
type NotFoundError struct { Name string }
func (e NotFoundError) Error() string { return "not found: " + e.Name }
func main() {
  var e error = NotFoundError{Name: "item"}
  console.log(e.Error())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "not found: item");
});

test("return custom error from function returning error", () => {
	const { js, errors } = compile(`package main
type ValidationError struct { Field string; Message string }
func (e ValidationError) Error() string { return e.Field + ": " + e.Message }
func validate(name string) error {
  if len(name) == 0 { return ValidationError{Field: "name", Message: "required"} }
  return nil
}
func main() {
  err := validate("")
  if err != nil { console.log(err.Error()) }
  err2 := validate("ok")
  console.log(err2 == nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "name: required\ntrue");
});

test("custom error .Error() method called correctly", () => {
	const { js, errors } = compile(`package main
type TimeoutError struct { Seconds int }
func (e TimeoutError) Error() string { return fmt.Sprintf("timeout after %d seconds", e.Seconds) }
func main() {
  e := TimeoutError{Seconds: 30}
  console.log(e.Error())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "timeout after 30 seconds");
});

section("Type assertions on errors");

test("type assertion on error to concrete type", () => {
	const { js, errors } = compile(`package main
type MyErr struct { Code int }
func (e MyErr) Error() string { return "err" }
func getErr() error { return MyErr{Code: 42} }
func main() {
  e := getErr()
  me := e.(MyErr)
  console.log(me.Code)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42");
});

test("type assertion comma-ok on error", () => {
	const { js, errors } = compile(`package main
type MyErr struct { Code int }
func (e MyErr) Error() string { return "err" }
func getErr() error { return MyErr{Code: 7} }
func main() {
  e := getErr()
  me, ok := e.(MyErr)
  console.log(ok)
  console.log(me.Code)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\n7");
});

test("type assertion fails for non-matching error type", () => {
	const { js, errors } = compile(`package main
type ErrA struct {}
func (e ErrA) Error() string { return "a" }
type ErrB struct {}
func (e ErrB) Error() string { return "b" }
func getErr() error { return ErrA{} }
func main() {
  e := getErr()
  _, ok := e.(ErrB)
  console.log(ok)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "false");
});

section("errors.Is / errors.Unwrap");

test("errors.Unwrap returns wrapped error", () => {
	const { js, errors } = compile(`package main
func main() {
  inner := errors.New("disk full")
  outer := fmt.Errorf("write failed: %w", inner)
  unwrapped := errors.Unwrap(outer)
  console.log(unwrapped.Error())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "disk full");
});

test("errors.Unwrap returns nil for non-wrapped error", () => {
	const { js, errors } = compile(`package main
func main() {
  e := errors.New("plain")
  u := errors.Unwrap(e)
  console.log(u == nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("errors.Is matches sentinel error", () => {
	const { js, errors } = compile(`package main
var ErrNotFound = errors.New("not found")
func lookup() error { return ErrNotFound }
func main() {
  err := lookup()
  console.log(errors.Is(err, ErrNotFound))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("errors.Is walks error chain", () => {
	const { js, errors } = compile(`package main
var ErrNotFound = errors.New("not found")
func main() {
  wrapped := fmt.Errorf("lookup: %w", ErrNotFound)
  console.log(errors.Is(wrapped, ErrNotFound))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("errors.Is returns false for different sentinel", () => {
	const { js, errors } = compile(`package main
var ErrNotFound = errors.New("not found")
var ErrTimeout = errors.New("timeout")
func main() {
  console.log(errors.Is(ErrNotFound, ErrTimeout))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "false");
});

section("fmt.Errorf with %w");

test("fmt.Errorf with %w wraps error", () => {
	const { js, errors } = compile(`package main
func main() {
  inner := errors.New("file not found")
  outer := fmt.Errorf("read config: %w", inner)
  console.log(outer.Error())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "read config: file not found");
});

test("fmt.Errorf with %w: Unwrap returns original", () => {
	const { js, errors } = compile(`package main
func main() {
  inner := errors.New("disk full")
  outer := fmt.Errorf("write: %w", inner)
  u := errors.Unwrap(outer)
  console.log(u.Error())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "disk full");
});

test("fmt.Errorf without %w does not wrap", () => {
	const { js, errors } = compile(`package main
func main() {
  e := fmt.Errorf("error %d", 42)
  u := errors.Unwrap(e)
  console.log(u == nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

section("Sentinel errors");

test("package-level error vars as sentinels", () => {
	const { js, errors } = compile(`package main
var ErrAuth = errors.New("unauthorized")
func check(ok bool) error {
  if !ok { return ErrAuth }
  return nil
}
func main() {
  err := check(false)
  console.log(errors.Is(err, ErrAuth))
  err2 := check(true)
  console.log(err2 == nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\ntrue");
});

test("errors.Is with sentinel across function call", () => {
	const { js, errors } = compile(`package main
var ErrNotFound = errors.New("not found")
func find(name string) error {
  if name == "" { return ErrNotFound }
  return nil
}
func process() error {
  return fmt.Errorf("process: %w", find(""))
}
func main() {
  err := process()
  console.log(errors.Is(err, ErrNotFound))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

section("Error backward compatibility");

test("error toString() in string concatenation", () => {
	const { js, errors } = compile(`package main
func main() {
  e := errors.New("bad")
  s := "error: " + e.Error()
  console.log(s)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "error: bad");
});

test("(value, error) return pattern still works", () => {
	const { js, errors } = compile(`package main
func divide(a int, b int) (int, error) {
  if b == 0 { return 0, error("division by zero") }
  return a / b, nil
}
func main() {
  r, e := divide(10, 2)
  console.log(r, e == nil)
  _, e2 := divide(1, 0)
  console.log(e2.Error())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5 true\ndivision by zero");
});
