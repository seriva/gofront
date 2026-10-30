// GoFront test suite — type checks, type switch, interfaces

import { fileURLToPath } from "node:url";
import {
	assertEqual,
	assertErrorContains,
	assertProgramOutput,
	compile,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

section("Type validation checks");

const controlFlowErrorCases = [
	[
		"break outside loop and switch is an error",
		"package main\nfunc main() {\n  break\n}",
		"break",
	],
	[
		"continue outside loop is an error",
		"package main\nfunc main() {\n  continue\n}",
		"continue",
	],
	[
		"fallthrough outside switch is an error",
		"package main\nfunc main() {\n  fallthrough\n}",
		"fallthrough",
	],
	[
		"labeled continue outside loop is an error",
		"package main\nfunc main() {\nMyLabel:\n  continue MyLabel\n}",
		"continue",
	],
	[
		"labeled break outside loop and switch is an error",
		"package main\nfunc main() {\nMyLabel:\n  break MyLabel\n}",
		"break",
	],
	[
		"reassigning a const is an error",
		"package main\nconst MaxSize = 10\nfunc main() {\n  MaxSize = 20\n}",
		"const",
	],
	[
		"reassigning a local const is an error",
		"package main\nfunc main() {\n  const x = 5\n  x = 10\n}",
		"const",
	],
];

for (const [name, code, expected] of controlFlowErrorCases) {
	test(name, () => {
		const { errors } = compile(code);
		assertErrorContains(errors, expected);
	});
}

test("break inside for loop is valid", () => {
	const { js, errors } = compile(`package main
func main() {
  for i := 0; i < 3; i++ {
    if i == 1 { break }
    console.log(i)
  }
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0");
});

test("break inside switch is valid", () => {
	const { js, errors } = compile(`package main
func main() {
  x := 1
  switch x {
  case 1:
    break
  }
  console.log("done")
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "done");
});

test("continue inside for loop is valid", () => {
	const { js, errors } = compile(`package main
func main() {
  for i := 0; i < 3; i++ {
    if i == 1 { continue }
    console.log(i)
  }
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0\n2");
});

test("shadowing a const with a var in inner scope is allowed", () => {
	const { js, errors } = compile(`package main
const x = 5
func main() {
  x := 10
  console.log(x)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "10");
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
	assertErrorContains(errors, "Cannot assign untyped string to uint");
});

test("uint return type mismatch caught", () => {
	const { errors } = compile(`package main
func f() uint { return "bad" }`);
	assertErrorContains(errors, "Cannot assign untyped string to uint");
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
	assertErrorContains(errors, "cannot embed non-interface type");
});

test("interface body union constraint (IDENT | IDENT) parses and is used as constraint", () => {
	const { errors } = compile(`package main
type MyInt struct{}
type MyStr struct{}
type Either interface {
  MyInt | MyStr
}
func wrap[T Either](v T) T { return v }
func main() { wrap(MyInt{}) }`);
	assertEqual(errors.length, 0);
});

test("interface body pkg.TypeName embed parses correctly", () => {
	const { errors } = compile(`package main
import "io"
type ReadCloser interface {
  io.Reader
  Close() error
}
func use(rc ReadCloser) {}
func main() {}`);
	assertEqual(errors.length, 0);
});

// ── Interface satisfaction — strict signature checks ──────────

section("Interface satisfaction — strict signature checks");

test("pointer to struct with pointer-receiver methods satisfies interface via variable", () => {
	const { errors, js } = compile(`package main
type Sizer interface { Area() int }
type Shape struct { V int }
func (s *Shape) Area() int { return s.V }
func use(z Sizer) int { return z.Area() }
func newShape() *Shape { return &Shape{V: 3} }
func main() {
  s := newShape()
  var z Sizer = s
  console.log(use(s), z.Area())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3 3");
});

test("pointer to struct with value-receiver methods satisfies interface", () => {
	const { errors } = compile(`package main
type Namer interface { Name() string }
type Dog struct {}
func (d Dog) Name() string { return "rex" }
func greet(n Namer) {}
func main() {
  d := &Dog{}
  greet(d)
}`);
	assertEqual(errors.length, 0);
});

test("pointer to struct missing a method does not satisfy interface", () => {
	const { errors } = compile(`package main
type Sizer interface { Area() int; Perimeter() int }
type Shape struct { V int }
func (s *Shape) Area() int { return s.V }
func use(z Sizer) {}
func main() {
  s := &Shape{V: 3}
  use(s)
}`);
	assertErrorContains(errors, "does not implement");
});

test("interface value satisfies a narrower interface", () => {
	const { errors } = compile(`package main
type Drawable interface { Draw() int }
type Entity interface { Draw() int; Update() bool }
func use(d Drawable) int { return d.Draw() }
func main() {
  var e Entity
  var d Drawable = e
  use(e)
  _ = d
}`);
	assertEqual(errors.length, 0);
});

test("interface value does not satisfy an interface with extra methods", () => {
	const { errors } = compile(`package main
type Drawable interface { Draw() int }
type Entity interface { Draw() int; Update() bool }
func main() {
  var d Drawable
  var e Entity = d
  _ = e
}`);
	assertErrorContains(errors, "does not implement");
});

test("untyped constants are assignable to named basic types", () => {
	const { errors } = compile(`package main
type Mode string
type Level int
const ModeAll Mode = "all"
func use(m Mode, l Level) bool { return m == "opaque" || l == 3 }
func main() {
  var m Mode = "lines"
  var l Level = 2
  switch m {
  case ModeAll, "lines":
  }
  _ = use("all", l)
  _ = map[Mode]int{"x": 1}
}`);
	assertEqual(errors.length, 0);
});

test("untyped constant of the wrong kind is rejected for a named basic type", () => {
	const { errors } = compile(`package main
type Mode string
func main() {
  var m Mode = 3
  _ = m
}`);
	assertErrorContains(errors, "Cannot assign");
});

const interfaceMismatchCases = [
	[
		"interface not satisfied when method has wrong parameter type",
		`package main\ntype Greeter interface { Greet(name string) }\ntype Bot struct{}\nfunc (b Bot) Greet(name int) {}\nfunc hello(g Greeter) {}\nfunc main() { hello(Bot{}) }`,
	],
	[
		"interface not satisfied when method has wrong parameter count",
		`package main\ntype Runner interface { Run(speed int) }\ntype Dog struct{}\nfunc (d Dog) Run() {}\nfunc race(r Runner) {}\nfunc main() { race(Dog{}) }`,
	],
	[
		"interface not satisfied when method has extra parameters",
		`package main\ntype Pinger interface { Ping() }\ntype Bot struct{}\nfunc (b Bot) Ping(addr string) {}\nfunc check(p Pinger) {}\nfunc main() { check(Bot{}) }`,
	],
	[
		"interface not satisfied when method has wrong second return type",
		`package main\ntype Loader interface { Load() (string, error) }\ntype Cache struct{}\nfunc (c Cache) Load() (string, int) { return "x", 0 }\nfunc fetch(l Loader) {}\nfunc main() { fetch(Cache{}) }`,
	],
	[
		"interface not satisfied when method has fewer return values",
		`package main\ntype Loader interface { Load() (string, error) }\ntype Cache struct{}\nfunc (c Cache) Load() string { return "x" }\nfunc fetch(l Loader) {}\nfunc main() { fetch(Cache{}) }`,
	],
	[
		"interface not satisfied when method parameter has distinct named type sharing underlying primitive",
		`package main\ntype USD int\ntype EUR int\ntype Converter interface { Convert(amount USD) }\ntype Bank struct{}\nfunc (b Bank) Convert(amount EUR) {}\nfunc run(c Converter) {}\nfunc main() { run(Bank{}) }`,
	],
	[
		"interface not satisfied when method return has distinct named type sharing underlying primitive",
		`package main\ntype USD int\ntype EUR int\ntype Exchanger interface { Exchange() USD }\ntype Bank struct{}\nfunc (b Bank) Exchange() EUR { return 0 }\nfunc run(e Exchanger) {}\nfunc main() { run(Bank{}) }`,
	],
];

for (const [name, code] of interfaceMismatchCases) {
	test(name, () => {
		const { errors } = compile(code);
		assertErrorContains(errors, "does not implement");
	});
}

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
	const { js, errors } = compile(`package main
func main() {
  var x interface{} = 42
  println(x)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42");
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
	const { js, errors } = compile(`package main
func main() {
  var n int = 42
  var x interface{} = n
  println(x)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42");
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
	const { js, errors } = compile(`package main
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
	assertEqual(runJs(js), "2");
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
	const { js, errors } = compile(`package main
func abs(x int) int {
  if x >= 0 {
    return x
  } else {
    return -x
  }
}
func main() { console.log(abs(-5), abs(3)) }`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5 3");
});

test("function with switch+default all returning is valid", () => {
	const { js, errors } = compile(`package main
func sign(x int) string {
  switch {
  case x > 0:
    return "positive"
  case x < 0:
    return "negative"
  default:
    return "zero"
  }
}
func main() { console.log(sign(1), sign(-1), sign(0)) }`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "positive negative zero");
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
	const { js, errors } = compile(`package main
func greet(name string) {
  if name != "" {
    println("hello " + name)
  }
}
func main() { greet("Go") }`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello Go");
});

test("function ending in panic() is terminating", () => {
	const { js, errors } = compile(`package main
func mustPositive(n int) int {
  if n > 0 {
    return n
  }
  panic("non-positive")
}
func main() { console.log(mustPositive(5)) }`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5");
});

test("infinite for loop (no cond, no break) is terminating", () => {
	const { errors } = compile(`package main
func forever() int {
  for {}
}`);
	assertEqual(errors.length, 0);
});

test("infinite for loop with break is not terminating", () => {
	const { errors } = compile(`package main
func f() int {
  for { break }
}`);
	assertErrorContains(errors, "missing return");
});

test("labeled return statement is terminating", () => {
	const { errors } = compile(`package main
func f(x int) int {
result:
  return x * 2
}
func main() { console.log(f(5)) }`);
	assertEqual(errors.length, 0);
});

test("switch case ending in break (not return) is not terminating", () => {
	const { errors } = compile(`package main
func f(x int) string {
  switch x {
  case 1:
    break
  default:
    return "other"
  }
}`);
	assertErrorContains(errors, "missing return");
});

test("IncDecStmt as last statement is not terminating", () => {
	const { errors } = compile(`package main
func f() int {
  x := 0
  x++
}`);
	assertErrorContains(errors, "missing return");
});

// ═════════════════════════════════════════════════════════════
// ANY cascade suppression (TAINTED_ANY)
// ═════════════════════════════════════════════════════════════

section("ANY cascade suppression");

const cascadeCases = [
	[
		"undefined var in call chain produces exactly 1 error",
		"package main\nfunc main() {\n  x.Foo()\n}",
	],
	[
		"undefined var in selector produces exactly 1 error",
		"package main\nfunc main() {\n  _ = x.Foo\n}",
	],
	[
		"undefined var in binary expr produces exactly 1 error",
		'package main\nfunc main() {\n  var s string = x + "hello"\n  _ = s\n}',
	],
	[
		"undefined var in index expr produces exactly 1 error",
		"package main\nfunc main() {\n  _ = x[0]\n}",
	],
];

for (const [name, code] of cascadeCases) {
	test(name, () => {
		const { errors } = compile(code);
		assertEqual(errors.length, 1);
		assertErrorContains(errors, "Undefined: 'x'");
	});
}

test("two independent undefined vars produce 2 errors", () => {
	const { errors } = compile(`package main
func main() {
  x.Foo()
  y.Bar()
}`);
	assertEqual(errors.length, 2);
});

test("user-declared any is permissive — no cascade suppression via taint", () => {
	// GoFront treats 'any' like TS's any: permissive, not Go's strict interface{}.
	// TAINTED_ANY (error-derived any) suppresses cascades; user 'any' does not taint.
	const { errors } = compile(`package main
func main() {
  var x any
  x.SomeMethod()
  _ = x + 1
}`);
	assertEqual(errors.length, 0);
});

test("function literal assignable to named function type", () => {
	const { js, errors } = compile(`package main
type FilterFunc func(x int) bool
var globalFilter FilterFunc

func main() {
  globalFilter = func(x int) bool {
    return x > 10
  }
  if globalFilter(15) {
    println("ok")
  }
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "ok");
});

test("function literal with mismatched signature to named func type fails typecheck", () => {
	const { errors } = compile(`package main
type FilterFunc func(x int) bool
var globalFilter FilterFunc

func main() {
  globalFilter = func(s string) bool {
    return true
  }
}`);
	assertEqual(errors.length, 1);
	assertErrorContains(errors, "Cannot assign func(string) bool to FilterFunc");
});

// ═════════════════════════════════════════════════════════════
// Additional coverage
// ═════════════════════════════════════════════════════════════

section("Type switch nil binding and elided map keys");

test("type switch: case nil with a binding runs on every target", async () => {
	await assertProgramOutput(
		`package main

import (
	"errors"
	"fmt"
)

func check(err error) {
	switch e := err.(type) {
	case nil:
		_ = e
		fmt.Println("nil")
	default:
		fmt.Println("err", e)
	}
}

func main() {
	check(nil)
	check(errors.New("x"))
}
`,
		"nil\nerr x\n",
	);
});

test("composite literal: elided key of a non-composite key type is an error", () => {
	const { errors } = compile(`package main
func main() {
	_ = map[string]int{{1}: 1}
}
`);
	assertErrorContains(errors, "invalid composite literal type string");
});

section("Multi-value returns, grouped results, interface{} identity");

test("return forwards a multi-value call from an interface field", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type W interface{ Write(p []byte) (int, error) }
type bw struct{}

func (bw) Write(p []byte) (int, error) { return len(p), nil }

type hm struct{ inner W }

func (h *hm) Write(p []byte) (n int, err error) { return h.inner.Write(p) }

func main() {
	h := &hm{inner: bw{}}
	n, err := h.Write([]byte("xy"))
	fmt.Println(n, err)
}
`,
		"2 <nil>\n",
	);
});

test("return forwards a multi-value call with make argument", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type T struct{}

func (t T) App(b []byte) ([]byte, error) { return append(b, 1), nil }

func (t T) Go() ([]byte, error) { return t.App(make([]byte, 0, 20)) }

func main() {
	b, err := T{}.Go()
	fmt.Println(b, err)
}
`,
		"[1] <nil>\n",
	);
});

test("return forwards ReadRune from a strings.Reader", async () => {
	await assertProgramOutput(
		`package main

import (
	"fmt"
	"strings"
)

type rd struct{ r *strings.Reader }

func (x rd) Next() (rune, int, error) { return x.r.ReadRune() }

func main() {
	r, n, err := rd{strings.NewReader("a")}.Next()
	fmt.Println(r, n, err)
}
`,
		"97 1 <nil>\n",
	);
});

test("return forwards Write from a strings.Builder field", async () => {
	await assertProgramOutput(
		`package main

import (
	"fmt"
	"strings"
)

type sw struct{ sb strings.Builder }

func (s *sw) Write(p []byte) (int, error) { return s.sb.Write(p) }

func main() {
	s := &sw{}
	n, _ := s.Write([]byte("hi"))
	fmt.Println(n)
}
`,
		"2\n",
	);
});

test("return forwarding a call with the wrong result count still errors", () => {
	const { errors } = compile(`package main
func two() (int, int) { return 1, 2 }
func f() (int, int, int) { return two() }
func main() { _, _, _ = f() }`);
	assertErrorContains(errors, "return count mismatch");
});

test("grouped named results (r, theta float64)", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func Polar(x float64) (r, theta float64) { return x, 0 }

func Three() (a, b int, err error) { return 1, 2, nil }

func main() {
	r, th := Polar(2)
	fmt.Println(r, th)
	a, b, err := Three()
	fmt.Println(a, b, err)
}
`,
		"2 0\n1 2 <nil>\n",
	);
});

test("interface{} and any are identical in method signatures", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type Bag interface {
	Do(func(uint8) any) []any
}
type impl struct{}

func (impl) Do(f func(uint8) interface{}) []interface{} { return []interface{}{f(1)} }

func main() {
	var b Bag = impl{}
	fmt.Println(len(b.Do(func(x uint8) any { return x })))
	_, ok := any(impl{}).(Bag)
	fmt.Println(ok)
}
`,
		"1\ntrue\n",
	);
});

test("a real method signature mismatch still reports does not implement", () => {
	const { errors } = compile(`package main
type Bag interface{ Do(func(uint8) any) []any }
type impl struct{}
func (impl) Do(f func(uint8) int) []any { return nil }
func main() { var b Bag = impl{}; _ = b }`);
	assertErrorContains(errors, "does not implement");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
