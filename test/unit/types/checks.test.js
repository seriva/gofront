// GoFront test suite — type checks, type switch, interfaces

import { fileURLToPath } from "node:url";
import { exprText } from "../../../src/typechecker/operand-text.js";
import {
	assertAllTargetsOutput,
	assertEqual,
	assertErrorContains,
	assertJsProgramOutput,
	assertProgramOutput,
	assertWasmProgramOutput,
	compile,
	compileDir,
	compileWasm,
	Lexer,
	Parser,
	runJs,
	section,
	summarize,
	test,
	toCompileResult,
	withTempDir,
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
		"cannot assign to MaxSize (neither addressable",
	],
	[
		"reassigning a local const is an error",
		"package main\nfunc main() {\n  const x = 5\n  x = 10\n}",
		"cannot assign to x (neither addressable",
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
	assertEqual(runJs(js), "3.140000104904175");
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

test("int8, int16, int64 all accepted with explicit conversions", () => {
	const js = compile(`package main
func main() {
	var a int8 = 1
	var b int16 = 2
	var c int64 = 3
	console.log(int64(a) + int64(b) + c)
}`).js;
	assertEqual(runJs(js), "6");
});

test("int8 + int16 + int64 without conversions is a mismatch", () => {
	const { errors } = compile(`package main
func main() {
	var a int8 = 1
	var b int16 = 2
	var c int64 = 3
	console.log(a + b + c)
}`);
	assertErrorContains(errors, "mismatched types int8 and int16");
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
	assertErrorContains(
		errors,
		'cannot use "oops" (untyped string constant) as uint value in argument to f',
	);
});

test("uint return type mismatch caught", () => {
	const { errors } = compile(`package main
func f() uint { return "bad" }`);
	assertErrorContains(
		errors,
		'cannot use "bad" (untyped string constant) as uint value in return statement',
	);
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
	assertErrorContains(
		errors,
		"cannot use 3 (untyped int constant) as Mode value in variable declaration",
	);
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

test("any cannot be passed or assigned to a concrete struct without an assertion", () => {
	const call = compile(`package main
type A struct{ N int }
func f(a A) int { return a.N }
func main() {
  var x any = A{3}
  _ = f(x)
}`);
	assertErrorContains(call.errors, "cannot use");
	assertErrorContains(call.errors, "need type assertion");
	const decl = compile(`package main
type A struct{ N int }
func main() {
  var x any = A{3}
  var a A = x
  _ = a
}`);
	assertErrorContains(decl.errors, "need type assertion");
	const ok = compile(`package main
type A struct{ N int }
func main() {
  var x any = A{3}
  var a A = x.(A)
  var y any = x
  _ = a
  _ = y
}`);
	assertEqual(ok.errors.length, 0);
});

const anyProducerCases = [
	[
		"recover()",
		`package main
func main() {
  defer func() {
    var n int = recover()
    _ = n
  }()
}`,
	],
	[
		"any(x) conversion",
		`package main
func main() {
  var n int = any(2)
  _ = n
}`,
	],
	[
		"v.(any) assertion",
		`package main
func main() {
  var v any = 2
  var n int = v.(any)
  _ = n
}`,
	],
	[
		"type switch default binding",
		`package main
func main() {
  var v any = 2
  switch x := v.(type) {
  case string:
    _ = x
  default:
    var n int = x
    _ = n
  }
}`,
	],
	[
		"type switch multi-type case binding",
		`package main
func main() {
  var v any = 2
  switch x := v.(type) {
  case string, bool:
    var n int = x
    _ = n
  }
}`,
	],
];
for (const [name, src] of anyProducerCases) {
	test(`${name} is a Go any: needs a type assertion`, () => {
		assertErrorContains(compile(src).errors, "need type assertion");
	});
}

test("a JS-dynamic any value stays assignable to int", () => {
	const { errors } = compile(`package main
func main() {
  var n int = document.foo
  _ = n
}`);
	assertEqual(errors.length, 0);
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
    _ = v
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
  for {
    if x < 0 {
      continue result
    }
    return x * 2
  }
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
	// GoFront treats 'any' like TS's any for member access, but arithmetic on a
	// Go `any` is rejected; TAINTED_ANY (error-derived any) suppresses cascades.
	const { errors } = compile(`package main
func main() {
  var x any
  x.SomeMethod()
  _ = x + 1
}`);
	assertEqual(errors.length, 1);
	assertErrorContains(errors, "x + 1 (mismatched types any and untyped int)");
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
	assertErrorContains(
		errors,
		"(value of type func(string) bool) as FilterFunc value in assignment",
	);
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
	assertErrorContains(
		errors,
		"not enough return values (have (int, int), want (int, int, int))",
	);
});

test("a forwarded return reports its count error at the call", () => {
	const few = compile(`package main
func pair() (int, string) { return 1, "a" }
func three() (int, string, bool) {
	return pair()
}
func main() { _, _, _ = three() }`);
	assertErrorContains(few.errors, "not enough return values");
	assertEqual(`${few.errors[0].line}:${few.errors[0].col}`, "4:9");
	const many = compile(`package main
func pair() (int, string) { return 1, "a" }
func one() int {
	return pair()
}
func main() { _ = one() }`);
	assertErrorContains(many.errors, "too many return values");
	assertEqual(`${many.errors[0].line}:${many.errors[0].col}`, "4:9");
});

test("a multi-value call next to other arguments is a single-value error", () => {
	for (const call of [
		"print(1, f2())",
		"println(f2(), 1)",
		"fmt.Println(f2(), 1)",
		"fmt.Println(1, f2())",
		"_ = min(1, f2())",
		"_ = append([]int{}, f2())",
	]) {
		const src = `package main
import "fmt"
func f2() (int, int) { return 1, 2 }
func main() { fmt.Print(); ${call} }`;
		const js = compile(src);
		assertErrorContains(
			js.errors,
			"multiple-value f2() (value of type (int, int)) in single-value context",
		);
		assertErrorContains(
			compile(src, { target: "both" }).errors,
			"in single-value context",
		);
		assertErrorContains(compileWasm(src).errors, "in single-value context");
	}
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

section("Named results in function literals");

test("function literals with named results run on every target", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

var f = func() (res int) { res = 4; return }

func main() {
	g := func() (xs []int) { xs = []int{1}; return }
	fmt.Println(g())
	fmt.Println(f())
	h := func(n int) (r string) { r = "x"; return r }
	fmt.Println(h(1))
	k := func() (a, b int, err error) { a, b = 1, 2; return }
	fmt.Println(k())
	d := func() (n int) {
		defer func() { n *= 2 }()
		n = 3
		return
	}
	fmt.Println(d())
	outer := func() (v int) {
		inner := func() (v string) { v = "in"; return }
		_ = inner()
		v = 7
		return
	}
	fmt.Println(outer())
	z := func() (n int, s string) { return }
	fmt.Println(z())
}
`,
		"[1]\n4\nx\n1 2 <nil>\n6\n7\n0 \n",
	);
});

test("a function literal without named results still needs a return value", () => {
	const { errors } = compile(`package main
func main() {
	f := func() int { return }
	_ = f
}`);
	assertErrorContains(errors, "Missing return value");
});

section("Comma-ok in var declarations");

test("var v, ok = m[k] and x.(T) run on every target", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type st struct{ n int }

func two() (int, string) { return 1, "a" }

var gm = map[string]int{"k": 4}
var gv, gok = gm["k"]
var gv2, gok2 = gm["z"]
var ga, gb = two()

func main() {
	var w, ok1 = any(st{}).(interface{ M() })
	fmt.Println(w == nil, ok1)
	var n, ok2 = any(5).(int)
	fmt.Println(n, ok2)
	var s, ok3 = any(5).(string)
	fmt.Printf("%q %v\\n", s, ok3)
	m := map[string]int{"k": 3}
	var v, ok4 = m["k"]
	fmt.Println(v, ok4)
	var v2, ok5 = m["z"]
	_ = v2
	fmt.Println(ok5)
	var _, ok6 = m["k"]
	fmt.Println(ok6)
	var p, ok7 = any(&st{2}).(*st)
	fmt.Println(p.n, ok7)
	var a, b = two()
	fmt.Println(a, b)
	_ = gv2
	fmt.Println(gv, gok, gok2, ga, gb)
}
`,
		'true false\n5 true\n"" false\n3 true\nfalse\ntrue\n2 true\n1 a\n4 true false 1 a\n',
	);
});

test("var _, ok = error(many{}).(interface{ Unwrap() []error }) is true in wasm", async () => {
	await assertWasmProgramOutput(
		`package main

import "fmt"

type many struct{}

func (many) Error() string   { return "m" }
func (many) Unwrap() []error { return nil }

func main() {
	var _, ok = error(many{}).(interface{ Unwrap() []error })
	fmt.Println(ok)
}
`,
		"true\n",
	);
});

test("var v, ok with a non-comma-ok value is still a mismatch", () => {
	const { errors } = compile(`package main
func main() {
	x := 1
	var v, ok = x
	_, _ = v, ok
}`);
	assertErrorContains(errors, "assignment mismatch: 2 variables but 1 value");
});

section("Self-referential local types");

test("a type declared inside a function may refer to itself", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	type L struct {
		next *L
		v    int
	}
	a := &L{v: 1}
	b := &L{next: a, v: 2}
	fmt.Println(b.v, b.next.v)
	type Tree struct {
		kids []Tree
		n    int
	}
	t := Tree{kids: []Tree{{n: 2}, {n: 3}}, n: 1}
	sum := t.n
	for _, k := range t.kids {
		sum += k.n
	}
	fmt.Println(sum)
	type Visit func(*L) int
	var f Visit = func(p *L) int { return p.v }
	fmt.Println(f(b))
	for p := b; p != nil; p = p.next {
		fmt.Print(p.v, " ")
	}
	fmt.Println()
}
`,
		"2 1\n6\n2\n2 1 \n",
	);
});

test("an unknown name in a local type is still reported", () => {
	const { errors } = compile(`package main
func main() {
	type L struct{ next *M }
	_ = L{}
}`);
	assertErrorContains(errors, "Unknown type 'M'");
});

section("Termination analysis follows fallthrough");

test("a switch whose clause falls through into a returning clause terminates", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func f(n int) int {
	switch n {
	case 0:
		return 0
	case 1:
		fallthrough
	case 2:
		return 1
	default:
		return 2
	}
}

func main() {
	fmt.Println(f(0), f(1), f(2), f(3))
}
`,
		"0 1 1 2\n",
	);
});

test("a switch whose last clause falls off the end is still missing a return", () => {
	const { errors } = compile(`package main
func f(n int) int {
	switch n {
	case 0:
		return 0
	case 1:
		fallthrough
	default:
		n++
	}
}
func main() { _ = f(1) }`);
	assertErrorContains(errors, "missing return at end of function 'f'");
});

test("a fallthrough into a clause that falls off the end is still missing a return", () => {
	const { errors } = compile(`package main
func f(n int) int {
	switch n {
	case 0:
		fallthrough
	case 1:
		n++
	default:
		return 2
	}
}
func main() { _ = f(1) }`);
	assertErrorContains(errors, "missing return at end of function 'f'");
});

test("a float64 variable is not assignable to int", () => {
	for (const target of ["js", "both"]) {
		assertErrorContains(
			compile(
				`package main
func main() {
	var y float64 = 1
	var i int = y
	_ = i
}`,
				{ target },
			).errors,
			"cannot use y (variable of type float64) as int value",
		);
	}
	assertErrorContains(
		compileWasm(`package main
func main() {
	var y float64 = 1
	var i int = y
	_ = i
}`).errors,
		"cannot use y (variable of type float64) as int value",
	);
});

test("a float64 expression is not assignable to int in assignments, calls and returns", () => {
	assertErrorContains(
		compile(`package main
func main() {
	y := 1.5
	i := 0
	i = y * 2
	_ = i
}`).errors,
		"cannot use y * 2 (value of type float64) as int value in assignment",
	);
	assertErrorContains(
		compile(`package main
func f(n int) {}
func main() {
	y := 1.5
	f(y)
}`).errors,
		"cannot use y (variable of type float64) as int value in argument",
	);
	assertErrorContains(
		compile(`package main
func f(y float64) int { return y }
func main() { _ = f(1) }`).errors,
		"cannot use y (variable of type float64) as int value in return statement",
	);
});

test("untyped constants and explicit conversions still reach int", async () => {
	await assertProgramOutput(
		`package main
import "fmt"
const c = 2.0
func main() {
	var i int = 1.0
	var j int = c
	y := 2.7
	k := int(y)
	var f float64 = 3
	fmt.Println(i, j, k, f)
}`,
		"1 2 2 3\n",
	);
});

section("Switch case types");

test("a case value must be convertible to the switch tag type", () => {
	const prog = (decl, tag, cas) => `package main
${decl}
func main() {
	var v ${tag}
	switch v {
	case ${cas}:
	}
}`;
	for (const target of ["js", "both"]) {
		assertErrorContains(
			compile(prog("", "string", "5"), { target }).errors,
			"cannot convert 5 (untyped int constant) to type string",
		);
	}
	assertErrorContains(
		compileWasm(prog("", "string", "5")).errors,
		"cannot convert 5 (untyped int constant) to type string",
	);
	assertErrorContains(
		compile(prog("", "int", '"a"')).errors,
		'cannot convert "a" (untyped string constant) to type int',
	);
	assertErrorContains(
		compile(prog("", "bool", "1")).errors,
		"cannot convert 1 (untyped int constant) to type bool",
	);
});

test("a typed case value must match the switch tag type", () => {
	assertErrorContains(
		compile(`package main
func main() {
	var v int
	s := "a"
	switch v {
	case s:
	}
}`).errors,
		"invalid case s in switch on v (mismatched types string and int)",
	);
});

test("valid switch case types still compile", async () => {
	await assertProgramOutput(
		`package main
import "fmt"
type Mode string
type Color int
const Red Color = 1
func main() {
	var m Mode = "x"
	var c Color = 1
	var f float64 = 2
	var r rune = 'a'
	var e error
	var a any = 3
	n := 3
	switch m {
	case "x":
		fmt.Println("mode")
	}
	switch c {
	case Red, 2:
		fmt.Println("color")
	}
	switch f {
	case 2:
		fmt.Println("float")
	}
	switch r {
	case 'a':
		fmt.Println("rune")
	}
	switch e {
	case nil:
		fmt.Println("nil")
	}
	switch a {
	case 3, "s":
		fmt.Println("any")
	}
	switch n {
	case n:
		fmt.Println("same")
	}
	switch {
	case n > 2:
		fmt.Println("tagless")
	}
}`,
		"mode\ncolor\nfloat\nrune\nnil\nany\nsame\ntagless\n",
	);
});

section("JS dynamic types: boxed values keep their type");

test("a nil map or nil pointer in any is not the nil interface", async () => {
	await assertJsProgramOutput(
		`package main

import "fmt"

type P struct{ x int }
type many []error

func (m many) Error() string   { return "m" }
func (m many) Unwrap() []error { return m }

func chk(a any) bool { return a == nil }

func main() {
	fmt.Println(any(map[string]int(nil)) == nil)
	var m map[string]int
	fmt.Println(chk(m), chk(map[int]int(nil)))
	var a any = (*P)(nil)
	fmt.Println(a == nil)
	var i *int
	fmt.Println(chk(i), chk((*P)(nil)))
	var e error = many{}
	_, ok := e.(interface{ Unwrap() []error })
	fmt.Println(ok)
	_, ok = error(many{}).(interface{ Unwrap() error })
	fmt.Println(ok)
}`,
		"false\nfalse false\nfalse\nfalse false\ntrue\nfalse\n",
	);
});

section("JS dynamic types: assertions and type switches");

test("assertions match Go's type identity", async () => {
	await assertJsProgramOutput(
		`package main

import (
	"encoding/json"
	"fmt"
	"iter"
)

type L string
type T struct{ n int }

func (t T) Name() string { return "n" }
func (t *T) Size() int   { return 1 }

type namer interface{ Name() string }
type sizer interface {
	Name() string
	Size() int
}

func main() {
	_, ok := any(new(L)).(*string)
	fmt.Println(ok)
	var s string
	_, ok = any(&s).(*string)
	fmt.Println(ok)
	_, ok = any(&s).(*int)
	fmt.Println(ok)
	var v any = T{4}
	switch v.(type) {
	case sizer:
		fmt.Println("sizer")
	case namer:
		fmt.Println("namer")
	}
	v = &T{4}
	switch v.(type) {
	case sizer:
		fmt.Println("sizer")
	case namer:
		fmt.Println("namer")
	}
	var d any
	json.Unmarshal([]byte(\`{"a":1}\`), &d)
	switch d.(type) {
	case []any:
		fmt.Println("slice")
	case map[string]any:
		fmt.Println("map")
	}
	switch any([]int32{1}).(type) {
	case []uint8:
		fmt.Println("u8")
	case []int32:
		fmt.Println("i32")
	}
	switch any(map[string]int{}).(type) {
	case map[string]string:
		fmt.Println("ss")
	case map[string]int:
		fmt.Println("si")
	}
	var n any
	_, ok = n.(iter.Seq[int])
	fmt.Println(ok)
}`,
		"false\ntrue\nfalse\nnamer\nsizer\nmap\ni32\nsi\nfalse\n",
	);
});

test("a type parameter case matches before and after a basic case", async () => {
	await assertJsProgramOutput(
		`package main

import "fmt"

type Name string

func Kind[T any](v any) string {
	switch v.(type) {
	case string:
		return "str"
	case T:
		return "T"
	}
	return "other"
}

func main() {
	fmt.Println(Kind[Name](Name("a")), Kind[Name]("a"))
}`,
		"T str\n",
	);
});

section("String indexing and cap on maps");

test("string indexing yields byte on every target", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func cp(b byte) bool { return b == 46 }
func f(s string) bool { return cp(s[0]) }

func main() {
	var c byte = "."[0]
	fmt.Println(f("."), c)
}
`,
		"true 46\n",
	);
});

test("cap on a map is rejected", () => {
	const { errors } = compile(
		`package main
func main() {
	var m map[string]int
	_ = cap(m)
}`,
	);
	assertErrorContains(
		errors,
		"invalid argument: m (variable of type map[string]int) for cap",
	);
});

test("len on a map and cap on a slice stay valid", () => {
	const { errors } = compile(
		`package main
func main() {
	m := map[string]int{}
	s := []int{1}
	_ = len(m)
	_ = cap(s)
}`,
	);
	assertEqual(errors.length, 0);
});

section("Statement and operator checks");

const stmtErrorCases = [
	[
		"switch on untyped string tag rejects an int case",
		'package main\nfunc main() { switch "foo" {\n case 5: } }',
		"cannot convert 5 (untyped int constant) to type string",
	],
	[
		"tagless switch rejects a non-bool case",
		"package main\nfunc main() { switch {\n case 5: } }",
		"invalid case 5 in switch",
	],
	[
		"fractional untyped float is not an int",
		"package main\nfunc main() { var i int = 1.5; _ = i }",
		"cannot use 1.5 (untyped float constant) as int value in variable declaration (truncated)",
	],
	[
		"comparing byte with int is a mismatch",
		'package main\nfunc main() { s := "abc"; q := byte(97); _ = s[0] != int(q) }',
		"mismatched types",
	],
	[
		"cap of a string is invalid",
		'package main\nfunc main() { _ = cap("hello") }',
		"invalid argument",
	],
	[
		"comma-ok assertion with no new variables",
		"package main\nfunc main() { var a any = 1; var x int; var ok bool; _, _ = x, ok; x, ok := a.(int) }",
		"no new variables on left side of :=",
	],
];

for (const [name, code, expected] of stmtErrorCases) {
	test(name, () => {
		assertErrorContains(compile(code).errors, expected);
	});
}

test("valid cases still compile", () => {
	const { errors } = compile(`package main
func main() {
	var i int = 2.0
	var b byte = 1
	var c byte = 2
	switch { case i > 1: }
	switch true { case i > 1: }
	switch 5 { case 5: }
	_ = b == c
	_ = b != 'a'
	_ = i
}`);
	assertEqual(errors.length, 0);
});

test("comma-ok map lookup with a 64-bit constant key", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
func main() {
	m := map[int64]string{1 << 60: "hello"}
	v, ok := m[1<<60]
	fmt.Println(v, ok)
	v, ok = m[1<<60]
	fmt.Println(v, ok)
}
`,
		"hello true\nhello true\n",
	);
});

section("A rejected range operand");

test("a range assignment over a non-iterator func reports once", () => {
	for (const lhs of ["x", "x, y"]) {
		for (const target of ["js", "both", "wasm"]) {
			const { errors } = compile(
				`package main
func fn(int) {}
func main() {
	var x, y int
	for ${lhs} = range fn {
		_, _ = x, y
	}
}`,
				{ target },
			);
			assertErrorContains(errors, "cannot range over func");
			assertEqual(errors.length, 1);
		}
	}
});

section("Operand text");

// The first expression of `_ = <src>` (or its first call argument for `arg`).
function parsedOperand(src, arg = false) {
	const code = `package main\nfunc main() {\n\t_ = ${src}\n}\n`;
	const ast = new Parser(
		new Lexer(code, "m.go").tokenize(),
		"m.go",
		code,
	).parse();
	const rhs = ast.decls[0].body.stmts[0].rhs[0];
	return arg ? rhs.args[0] : rhs;
}

const operandTextCases = [
	["[2]int{1, 2}", "[2]int{…}"],
	["[2]int{1, 2}[0]", "[2]int{…}[0]"],
	["P{}", "P{}"],
	["P{}.X", "P{}.X"],
	["&P{X: 1}", "&P{…}"],
	["[]string{}", "[]string{}"],
	['map[string][]int{"a": nil}', "map[string][]int{…}"],
	[
		'struct{ X int; Y, Z string }{1, "a", "b"}',
		"struct{X int; Y, Z string}{…}",
	],
	["pkg.T{}", "pkg.T{}"],
	["Box[int]{V: 1}", "Box[int]{…}"],
	["i.(P)", "i.(P)"],
	["i.(P).X", "i.(P).X"],
	["i.(*P)", "i.(*P)"],
	["i.(map[string]int)", "i.(map[string]int)"],
	["float64(x)", "float64(x)"],
	["[]byte(s)", "[]byte(s)"],
	["struct{ E }(a)", "struct{E}(a)"],
	["interface{ M(int) string }(v)", "interface{M(int) string}(v)"],
	["xs[1:]", "xs[1:]"],
	["xs[:2]", "xs[:2]"],
	["xs[:]", "xs[:]"],
	["xs[a:b:c]", "xs[a:b:c]"],
	["xs[1:][0]", "xs[1:][0]"],
	["func() {}", "(func() literal)"],
	[
		"func(a, b int, s ...string) (int, error) { return 0, nil }",
		"(func(a, b int, s ...string) (int, error) literal)",
	],
	[
		"func(int, string) bool { return true }",
		"(func(int, string) bool literal)",
	],
	[
		"func() (n int, err error) { return }",
		"(func() (n int, err error) literal)",
	],
	["f[int]", "f[int]"],
	["f[int, []string]", "f[int, []string]"],
	["pkg.F[int]", "pkg.F[int]"],
	["await f()", "await f()"],
	["f(P{}, i.(T))", "f(P{}, i.(T))"],
];

for (const [src, want] of operandTextCases)
	test(`operand text of ${src}`, () => {
		assertEqual(exprText(parsedOperand(src)), want);
	});

test("operand text of a type argument and of every type form", () => {
	const arg = (src) => exprText(parsedOperand(src, true));
	assertEqual(arg("make(map[string]int)"), "map[string]int");
	assertEqual(arg("make([]*P, 3)"), "[]*P");
	assertEqual(arg("make([3]int)"), "[3]int");
	assertEqual(arg("make(Box[int])"), "Box[int]");
	const text = (src) => exprText(parsedOperand(src));
	assertEqual(text("[...]int{1}"), "[...]int{…}");
	assertEqual(text("[]func(int) string{}"), "[]func(int) string{}");
	assertEqual(text("[]func(){}"), "[]func(){}");
	assertEqual(
		text("[]interface{ ~int | ~float64 }{}"),
		"[]interface{~int | ~float64}{}",
	);
	assertEqual(
		text("[]interface{ Reader; M() }{}"),
		"[]interface{Reader; M()}{}",
	);
	assertEqual(text("[]struct{}{}"), "[]struct{}{}");
});

test("no operand kind of the table prints as the expression fallback", () => {
	for (const [src] of operandTextCases)
		assertEqual(exprText(parsedOperand(src)).includes("expression"), false);
});

section("Constant operand kinds");

// Every target prints a constant operand with its value, as Go does.
const constantKindCases = [
	[
		"a typed constant's address",
		"const k float64 = 2\n_ = &k",
		"cannot take address of k (constant 2 of type float64)",
	],
	[
		"an untyped float literal as a len argument",
		"_ = len(1e3)",
		"invalid argument: 1e3 (untyped float constant 1000) for built-in len",
	],
	[
		"a folded untyped constant statement",
		"1 + 2",
		"1 + 2 (untyped int constant 3) is not used",
	],
	[
		"a typed constant conversion statement",
		"float64(1)",
		"float64(1) (constant 1 of type float64) is not used",
	],
	[
		"a typed constant statement",
		"const k float64 = 2\nk",
		"k (constant 2 of type float64) is not used",
	],
	[
		"a named untyped constant statement",
		"const half = 0.5\nhalf",
		"half (untyped float constant 0.5) is not used",
	],
	[
		"a non-constant untyped bool statement",
		"x := 1\nx == 1",
		"x == 1 (untyped bool value) is not used",
	],
	[
		"a variable statement",
		"x := 1.5\nx",
		"x (variable of type float64) is not used",
	],
	[
		"a typed complex128 constant's address",
		"const c complex128 = 1 + 2i\n_ = &c",
		"cannot take address of c (constant (1 + 2i) of type complex128)",
	],
	[
		"a typed complex64 constant's address",
		"const c complex64 = 1 + 2i\n_ = &c",
		"cannot take address of c (constant (1 + 2i) of type complex64)",
	],
	[
		"a typed complex constant ranged over",
		"const c complex128 = 1 + 2i\nfor range c {}",
		"cannot range over c (constant (1 + 2i) of type complex128)",
	],
	[
		"an untyped rune constant's length",
		"const r = 'a'\n_ = len(r)",
		"invalid argument: r (untyped rune constant 97) for built-in len",
	],
	[
		"an untyped rune constant as a string case",
		"const r = 'a'\nswitch \"a\" {\ncase r:\n}",
		"cannot convert r (untyped rune constant 97) to type string",
	],
	[
		"an untyped rune constant ranged over with two variables",
		"const r = 'a'\nfor i, j := range r {\n_, _ = i, j\n}",
		"range over r (untyped rune constant 97) permits only one iteration variable",
	],
	[
		"a non-constant untyped bool converted",
		"x := 1\n_ = int(x == 1)",
		"cannot convert x == 1 (untyped bool value) to type int",
	],
	[
		"a non-constant untyped bool ranged over",
		"x := 1\nfor range x == 1 {}",
		"cannot range over x == 1 (untyped bool value)",
	],
	[
		"a non-constant shift as a len argument",
		"s := uint(1)\n_ = len(1 << s)",
		"invalid argument: 1 << s (untyped int value) for built-in len",
	],
	[
		"a non-constant shift converted to bool",
		"s := uint(1)\n_ = bool(1 << s)",
		"cannot convert 1 << s (untyped int value) to type bool",
	],
	[
		"a non-constant untyped bool as a switch case",
		"x := 1\nswitch 1 {\ncase x == 1:\n}",
		"(untyped bool value)",
	],
	[
		"a parenthesized pointer conversion statement",
		"var x int\n(*int)(&x)",
		"(*int)(&x) (value of type *int) is not used",
	],
	[
		"a struct conversion callee drops tags",
		'var a struct{ X int }\nstruct{ X int `json:"x"` }(a)',
		"struct{X int}(a)",
	],
	[
		"a struct literal selector drops tags",
		'_ = &struct{ X int `json:"x"` }{1}.X',
		"cannot take address of struct{X int}{…}.X (value of type int)",
	],
];

for (const [name, body, want] of constantKindCases)
	test(`constant operand kind: ${name}`, () => {
		for (const target of ["js", "both", "wasm"]) {
			const { errors } = compile(`package main\nfunc main() {\n${body}\n}`, {
				target,
			});
			assertErrorContains(errors, want);
		}
	});

test("a constant statement names the value of a string constant", () => {
	const { errors } = compile(
		'package main\nfunc main() {\nconst s = "a"\ns\n}',
	);
	assertErrorContains(errors, 's (untyped string constant "a") is not used');
});

section("Conversion errors name the operand");

const convertErrorCases = [
	[
		"a complex variable to an integer",
		"c := complex(1, 2)\n_ = int(c)",
		"cannot convert c (variable of type complex128) to type int",
	],
	[
		"a typed complex constant to an integer",
		"const c complex128 = 1 + 2i\n_ = int(c)",
		"cannot convert c (constant (1 + 2i) of type complex128) to type int",
	],
	["nil to an integer", "_ = int(nil)", "cannot convert nil to type int"],
	[
		"a string variable to a slice of ints",
		"var s string\n_ = []int(s)",
		"cannot convert s (variable of type string) to type []int",
	],
	[
		"a typed constant to a string slice",
		"const k float64 = 2\n_ = []string(k)",
		"cannot convert k (constant 2 of type float64) to type []string",
	],
	[
		"an untyped float constant to an integer",
		"_ = int(1.5)",
		"cannot convert 1.5 (untyped float constant) to type int (truncated)",
	],
];

for (const [name, body, want] of convertErrorCases)
	test(`conversion error: ${name}`, () => {
		for (const target of ["js", "both", "wasm"]) {
			const { errors } = compile(`package main\nfunc main() {\n${body}\n}`, {
				target,
			});
			assertErrorContains(errors, want);
		}
	});

test("a complex operand converted to an integer has no real() suffix", () => {
	const { errors } = compile(
		"package main\nfunc main() {\nc := complex(1, 2)\n_ = int(c)\n}",
	);
	assertErrorContains(errors, "to type int");
	assertEqual(
		errors.some((e) => String(e.message ?? e).includes("real() or imag()")),
		false,
	);
});

test("a conversion between pointers to distinct wasm structs names the operand", () => {
	const { errors } = compile(
		"package main\ntype A struct{ X int }\ntype B struct{ X int }\nfunc main() {\nvar p *A\n_ = (*B)(p)\n}",
		{ target: "wasm" },
	);
	assertErrorContains(
		errors,
		"cannot convert p (variable of type *A) to type *B in a wasm package",
	);
});

section("Assignment context names");

// One row per place a value is assigned: Go names it in `cannot use ... as T
// value in <context>`.
const assignContextCases = [
	[
		"variable declaration",
		"var s string = 1\n_ = s",
		"in variable declaration",
	],
	["assignment", "var s string\ns = 1", "in assignment"],
	["return statement", null, "in return statement"],
	["argument to f", 'f("x")', "in argument to f"],
	["argument to a method", 'var b Box\nb.M("x")', "in argument to b.M"],
	["argument to a variadic func", 'v(1, "x")', "in argument to v"],
	[
		"argument to append",
		'var xs []int\n_ = append(xs, "x")',
		"in argument to append",
	],
	[
		"argument to delete",
		"var m map[string]int\ndelete(m, 1)",
		"in argument to delete",
	],
	["struct literal", '_ = W{X: "x"}', "in struct literal"],
	["positional struct literal", '_ = W{"x"}', "in struct literal"],
	["array or slice literal", '_ = []int{"x"}', "in array or slice literal"],
	["array literal", '_ = [2]int{"x"}', "in array or slice literal"],
	["map literal value", '_ = map[string]int{"a": "x"}', "in map literal"],
	["map literal key", "_ = map[string]int{1: 2}", "in map literal"],
	["map index", "var m map[string]int\n_ = m[1]", "in map index"],
	["map index assignment", "var m map[string]int\nm[1] = 2", "in map index"],
	["comma-ok map index", "var m map[string]int\n_, _ = m[1]", "in map index"],
	[
		"range clause",
		"var s string\nfor s = range []int{1} {\n}\n_ = s",
		"cannot use s (value of type int) as string value in assignment",
	],
];

for (const [name, body, want] of assignContextCases)
	test(`assignment context: ${name}`, () => {
		const decls =
			"type W struct{ X int }\ntype Box struct{ n int }\nfunc (b Box) M(a int) {}\nfunc f(a int) {}\nfunc v(a ...int) {}\n";
		const src =
			body === null
				? `package main\n${decls}func g() int { return "a" }\nfunc main() {}`
				: `package main\n${decls}func main() {\n${body}\n}`;
		for (const target of ["js", "both", "wasm"]) {
			const { errors } = compile(src, { target });
			assertErrorContains(errors, want);
			assertErrorContains(errors, "cannot use");
		}
	});

test("a mismatched value reports its operand and kind", () => {
	const { errors } = compile(
		"package main\nfunc main() {\nvar a int32 = 1\nvar b int64 = a\n_ = b\n}",
	);
	assertErrorContains(
		errors,
		"cannot use a (variable of type int32) as int64 value in variable declaration",
	);
});

section("Spread arguments");

test("spreading into a variadic call, append, and fmt.Println still works", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func sum(a int, xs ...int) int {
	t := a
	for _, x := range xs {
		t += x
	}
	return t
}

func main() {
	xs := []int{2, 3}
	args := []any{"a", 1}
	fmt.Println(sum(1, xs...), sum(1))
	fmt.Println(args...)
	fmt.Println(append([]int{1}, xs...))
	fmt.Println(append([]byte("a"), "bc"...))
}
`,
		"6 1\na 1\n[1 2 3]\n[97 98 99]\n",
	);
});

section("Type conversions through aliases and type expressions");

test("L1/L1c/L1d/L1e/L1f: conversions through type aliases work on all targets", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type A = struct{ X int }
type S struct{ X int }
type L = []int
type F = func() int
type M = map[string]int
type P = *int
type Str = string
type I64 = int64
type R = []rune
type Arr = [2]int
type G[T any] struct{ V T }
type GA = G[int]
type B struct{ V int }

func g() int { return 2 }

func main() {
	u := A(S{1})
	var a2 [2]int = [2]int{4, 5}
	fmt.Println(u, len(L(nil)), F(g)(), len(M(nil)), P(nil) == nil)
	fmt.Println(Str(rune(65)), I64(5)+1, R("ab"), Arr(a2))
	fmt.Println(GA(B{3}), (([]int))(nil))
}
`,
		"{1} 0 2 0 true\nA 6 [97 98] [4 5]\n{3} []\n",
	);
});

test("string conversions to slice aliases with defined byte/rune elements work on all targets", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type MyByte byte
type MyBytes = []MyByte
type MyRune rune
type MyRunes = []MyRune

func main() {
	bs := MyBytes("ab")
	rs := MyRunes("cd")
	fmt.Println(bs, rs, ([]MyByte)("ef"), ([]MyRune)("gh"))
	fmt.Println(string(bs), string(rs))
}
`,
		"[97 98] [99 100] [101 102] [103 104]\nab cd\n",
	);
});

test("L1 negative: invalid alias conversion reports cannot convert, not non-function call", () => {
	for (const target of ["js", "both", "wasm"]) {
		const { errors } = compile(
			`package main
type A = struct{ X int }
func main() { _ = A(1) }
`,
			{ target },
		);
		assertErrorContains(errors, "cannot convert");
	}
});

section("Qualified type names resolve their qualifier first");

const NPM = 'import "nope/zzz"\n';
const qualifiedTypeCases = [
	[
		"a variable of a qualified type",
		`${NPM}var x zzz.T\nfunc main() { _ = x }`,
		3,
		7,
	],
	["a composite literal", `${NPM}func main() { _ = zzz.T{} }`, 3, 19],
	[
		"an instantiated generic type",
		`${NPM}var y zzz.T[int]\nfunc main() { _ = y }`,
		3,
		7,
	],
];

for (const [name, body, line, col] of qualifiedTypeCases) {
	for (const target of ["wasm", "both"]) {
		test(`${name} of an untyped npm import is js-only in a ${target} package (I2.1)`, () => {
			const { errors } = compile(`package main\n${body}\n`, { target });
			assertErrorContains(errors, "'zzz.T' is only available in js packages");
			assertErrorContains(errors, `at line ${line}:${col}`);
			assertEqual(
				errors.filter((e) => /Unknown struct|invalid composite/.test(e.message))
					.length,
				0,
			);
		});
	}
}

for (const target of ["js", "both", "wasm"]) {
	for (const [what, src] of [
		["a browser global", "func main() { _ = console.T{} }"],
		["a local variable", "func main() { v := 1; _ = v.T{} }"],
		["a parameter", "func f(v int) { _ = v.T{} }\nfunc main() { f(1) }"],
	]) {
		test(`a composite literal of ${what} qualified type is not a type in a ${target} package (I2.2)`, () => {
			const { errors } = compile(`package main\n${src}\n`, { target });
			assertErrorContains(errors, ".T is not a type");
			assertEqual(
				errors.filter((e) => /int has no field/.test(e.message)).length,
				0,
			);
		});
	}
}

test("a variable of a local variable's qualified type is not a type (I2.2)", () => {
	const { errors } = compile(
		"package main\nfunc main() { v := 1; var x v.T; _ = x }\n",
	);
	assertErrorContains(errors, "v.T is not a type");
});

test("a variable of a browser global's qualified type stays an unknown type (control)", () => {
	const { errors } = compile(
		"package main\nfunc main() { var x console.T; _ = x }\n",
	);
	assertErrorContains(errors, "Unknown type 'console.T'");
});

test("a typed package's qualified type and literal still resolve (control)", () => {
	const { js, errors } = compile(
		`package main
import "strings"
func main() {
	var b strings.Builder
	b.WriteString("a")
	_ = strings.Builder{}
	println(b.String())
}
`,
	);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js).trim(), "a");
});

test("a local variable named like an import hides the package in a type (I2.2)", () => {
	const { errors } = compile(
		`package main
import "strings"
func main() {
	strings := 1
	var b strings.Builder
	_, _ = strings, b
}
`,
	);
	assertErrorContains(errors, "strings.Builder is not a type");
});

section("Struct literals of another package's types");

const SUB_SRC = `package sub

type S struct {
	A int
	b int
}

type hidden struct{ X int }

type Pub struct{ hidden }

func NewHidden() hidden { return hidden{1} }
`;

function subErrors(mainBody, target) {
	return withTempDir(
		{
			"sub/sub.go": `//gofront:target ${target}\n${SUB_SRC}`,
			"main.go": `package main\n\nimport "./sub"\n\nfunc main() {\n\t${mainBody}\n}\n`,
		},
		(dir) => toCompileResult(() => compileDir(dir)).errors,
	);
}

for (const target of ["js", "both", "wasm"]) {
	for (const [what, body, want] of [
		[
			"a positional literal",
			"_ = sub.S{1, 2}",
			"implicit assignment to unexported field b in struct literal of type sub.S",
		],
		[
			"a keyed literal",
			"_ = sub.S{b: 2}",
			"cannot refer to unexported field b in struct literal of type sub.S",
		],
		[
			"a keyed literal of an unexported embedded field",
			"_ = sub.Pub{hidden: sub.NewHidden()}",
			"cannot refer to unexported field hidden in struct literal of type sub.Pub",
		],
		[
			"a positional literal of an unexported embedded field",
			"_ = sub.Pub{sub.NewHidden()}",
			"implicit assignment to unexported field hidden in struct literal of type sub.Pub",
		],
	]) {
		test(`${what} cannot set an unexported field of a ${target} package (E5)`, () => {
			assertErrorContains(subErrors(body, target), want);
		});
	}

	test(`a literal setting only exported fields of a ${target} package compiles (E5 control)`, () => {
		const errors = subErrors(
			"_ = sub.S{A: 1}\n\t_ = sub.Pub{}\n\t_ = sub.S{}",
			target,
		);
		assertEqual(errors.length, 0);
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
