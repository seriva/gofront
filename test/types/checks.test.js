// GoFront test suite — type checks, type switch, interfaces

import {
	assert,
	assertEqual,
	assertErrorContains,
	compile,
	runJs,
	section,
	test,
} from "../helpers.js";

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

// ── Interface satisfaction — strict signature checks ──────────

section("Interface satisfaction — strict signature checks");

test("interface not satisfied when method has wrong parameter type", () => {
	const { errors } = compile(`package main
type Greeter interface { Greet(name string) }
type Bot struct{}
func (b Bot) Greet(name int) {}
func hello(g Greeter) {}
func main() { hello(Bot{}) }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "does not implement");
});

test("interface not satisfied when method has wrong parameter count", () => {
	const { errors } = compile(`package main
type Runner interface { Run(speed int) }
type Dog struct{}
func (d Dog) Run() {}
func race(r Runner) {}
func main() { race(Dog{}) }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "does not implement");
});

test("interface not satisfied when method has extra parameters", () => {
	const { errors } = compile(`package main
type Pinger interface { Ping() }
type Bot struct{}
func (b Bot) Ping(addr string) {}
func check(p Pinger) {}
func main() { check(Bot{}) }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "does not implement");
});

test("interface not satisfied when method has wrong second return type", () => {
	const { errors } = compile(`package main
type Loader interface { Load() (string, error) }
type Cache struct{}
func (c Cache) Load() (string, int) { return "x", 0 }
func fetch(l Loader) {}
func main() { fetch(Cache{}) }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "does not implement");
});

test("interface not satisfied when method has fewer return values", () => {
	const { errors } = compile(`package main
type Loader interface { Load() (string, error) }
type Cache struct{}
func (c Cache) Load() string { return "x" }
func fetch(l Loader) {}
func main() { fetch(Cache{}) }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "does not implement");
});

test("interface satisfied when full signature matches", () => {
	const { js, errors } = compile(`package main
type Saver interface { Save(key string, value int) (bool, error) }
type DB struct{}
func (d DB) Save(key string, value int) (bool, error) { return true, nil }
func persist(s Saver) { console.log("ok") }
func main() { persist(DB{}) }`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "ok");
});

test("interface satisfied with matching variadic signature", () => {
	const { js, errors } = compile(`package main
type Logger interface { Log(msgs ...string) }
type Console struct{}
func (c Console) Log(msgs ...string) { console.log("logged") }
func use(l Logger) { l.Log("a", "b") }
func main() { use(Console{}) }`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "logged");
});

// ── interface{} assignability ────────────────────────────────

section("interface{} assignability");

test("var x interface{} = 42 is accepted", () => {
	const { errors } = compile(`package main
func main() {
  var x interface{} = 42
  println(x)
}`);
	assertEqual(errors.length, 0);
});

test("func(x interface{}) accepts concrete values", () => {
	const { js, errors } = compile(`package main
func show(x interface{}) {
  println(x)
}
func main() {
  show(42)
  show("hello")
  show(true)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42\nhello\ntrue");
});

test("typed value assignable to interface{} variable", () => {
	const { errors } = compile(`package main
func main() {
  var n int = 42
  var x interface{} = n
  println(x)
}`);
	assertEqual(errors.length, 0);
});

test("func(any) still accepts concrete values", () => {
	const { js, errors } = compile(`package main
func show(x any) { println(x) }
func main() { show(99) }`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "99");
});

// ── Comma-ok with = assignment ───────────────────────────────

section("Comma-ok with = assignment");

test("v, ok = m[key] with existing key", () => {
	const { js, errors } = compile(`package main
func main() {
  m := map[string]int{"a": 1}
  var v int
  var ok bool
  v, ok = m["a"]
  println(v, ok)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1 true");
});

test("v, ok = m[key] with missing key", () => {
	const { js, errors } = compile(`package main
func main() {
  m := map[string]int{"a": 1}
  var v int
  var ok bool
  v, ok = m["z"]
  println(v, ok)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0 false");
});

test("v, ok = x.(T) type assertion with = succeeds", () => {
	const { js, errors } = compile(`package main
func main() {
  var x any = 42
  var v int
  var ok bool
  v, ok = x.(int)
  println(v, ok)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42 true");
});

test("v, ok = x.(T) type assertion with = fails", () => {
	const { js, errors } = compile(`package main
func main() {
  var x any = "hello"
  var v int
  var ok bool
  v, ok = x.(int)
  println(v, ok)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0 false");
});

// ── Type switch multi-case capture variable ───────────────────

section("Type switch multi-case capture variable");

test("type switch with binding variable used in all cases", () => {
	const { js, errors } = compile(`package main
func describe(x any) string {
  switch v := x.(type) {
  case int:
    return "int"
  case string:
    return "string"
  default:
    return "other"
  }
}
func main() {
  println(describe(42))
  println(describe("hi"))
  println(describe(true))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "int\nstring\nother");
});

test("type switch capture var not reported as unused", () => {
	const { errors } = compile(`package main
func f(x any) {
  switch v := x.(type) {
  case int:
    println(v + 1)
  case string:
    println(v)
  case bool:
    println(v)
  }
}
func main() { f(1) }`);
	assertEqual(errors.length, 0);
});

// ── Terminating statement analysis ───────────────────────────

section("Terminating statement analysis");

test("function missing return is a type error", () => {
	const { errors } = compile(`package main
func f(x int) int {
  if x > 0 {
    return x
  }
}`);
	assertErrorContains(errors, "missing return");
});

test("function with all paths returning is valid", () => {
	const { errors } = compile(`package main
func abs(x int) int {
  if x >= 0 {
    return x
  } else {
    return -x
  }
}`);
	assertEqual(errors.length, 0);
});

test("function with switch+default all returning is valid", () => {
	const { errors } = compile(`package main
func sign(x int) string {
  switch {
  case x > 0:
    return "positive"
  case x < 0:
    return "negative"
  default:
    return "zero"
  }
}`);
	assertEqual(errors.length, 0);
});

test("switch without default is not terminating", () => {
	const { errors } = compile(`package main
func sign(x int) string {
  switch {
  case x > 0:
    return "positive"
  case x < 0:
    return "negative"
  }
}`);
	assertErrorContains(errors, "missing return");
});

test("void function does not need terminating analysis", () => {
	const { errors } = compile(`package main
func greet(name string) {
  if name != "" {
    println("hello " + name)
  }
}`);
	assertEqual(errors.length, 0);
});

test("function ending in panic() is terminating", () => {
	const { errors } = compile(`package main
func mustPositive(n int) int {
  if n > 0 {
    return n
  }
  panic("non-positive")
}`);
	assertEqual(errors.length, 0);
});

// ═════════════════════════════════════════════════════════════
// Additional coverage
// ═════════════════════════════════════════════════════════════
