// test/unit/wasm/interfaces.test.js
// Tests for Phase H4 Task H4.1: Non-empty interfaces in WASM and JS-strict parity.

import {
	assertAllTargetsOutput,
	assertEqual,
	assertProgramOutput,
	assertWasmProgramOutput,
	compile,
	compileHybrid,
	runJs,
	runWasm,
	section,
	test,
} from "../helpers.js";

section("WASM Non-Empty Interfaces — Method Dispatch & Parity");

test("Interface method dispatch with value receiver and pointer receiver", () => {
	const src = `
package main

type Animal interface {
	Sound() string
}

type Dog struct {
	Name string
}

func (d Dog) Sound() string {
	return "woof:" + d.Name
}

type Cat struct {
	Name string
}

func (c *Cat) Sound() string {
	return "meow:" + c.Name
}

func Speak(a Animal) string {
	return a.Sound()
}

func Main() string {
	d := Dog{Name: "Rex"}
	c := &Cat{Name: "Whiskers"}
	dPtr := &Dog{Name: "Buddy"}
	return Speak(d) + " | " + Speak(c) + " | " + Speak(dPtr)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "woof:Rex | meow:Whiskers | woof:Buddy");
	assertEqual(wasmRes, jsRes);
});

test("Interface with multiple methods and arguments", () => {
	const src = `
package main

type Calculator interface {
	Add(a, b int64) int64
	Scale(val float32, factor float32) float32
}

type Engine struct {
	Offset int64
}

func (e *Engine) Add(a, b int64) int64 {
	return a + b + e.Offset
}

func (e *Engine) Scale(val float32, factor float32) float32 {
	return val * factor
}

func Compute(c Calculator) int64 {
	sum := c.Add(10, 20)
	scaled := c.Scale(5.0, 2.0)
	return sum + int64(scaled)
}

func Main() int64 {
	eng := &Engine{Offset: 5}
	return Compute(eng)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 45n);
	assertEqual(wasmRes, jsRes);
});

test("Interface method returning multiple values", () => {
	const src = `
package main

type Divider interface {
	DivMod(a, b int64) (int64, int64)
}

type IntMath struct{}

func (m *IntMath) DivMod(a, b int64) (int64, int64) {
	return a / b, a % b
}

func Main() int64 {
	var d Divider = &IntMath{}
	q, r := d.DivMod(27, 4)
	return q*100 + r
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 603n);
	assertEqual(wasmRes, jsRes);
});

test("Embedded struct promoted methods satisfy interface", () => {
	const src = `
package main

type Speaker interface {
	Speak() string
}

type BaseSpeaker struct {
	Prefix string
}

func (b *BaseSpeaker) Speak() string {
	return b.Prefix + " speaks"
}

type Robot struct {
	BaseSpeaker
	Model int64
}

func Announce(s Speaker) string {
	return s.Speak()
}

func Main() string {
	r := &Robot{
		BaseSpeaker: BaseSpeaker{Prefix: "Unit42"},
		Model:       9000,
	}
	return Announce(r)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "Unit42 speaks");
	assertEqual(wasmRes, jsRes);
});

section("WASM Non-Empty Interfaces — Nil Semantics & Trapping");

test("Nil interface check == nil and != nil", () => {
	const src = `
package main

type Animal interface {
	Sound() string
}

type Dog struct{}

func (d *Dog) Sound() string {
	return "bark"
}

func Main() int64 {
	var a Animal
	var score int64
	if a == nil {
		score += 10
	}
	if a != nil {
		score += 100
	}

	a = &Dog{}
	if a != nil {
		score += 1000
	}
	if a == nil {
		score += 10000
	}
	return score
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 1010n);
	assertEqual(wasmRes, jsRes);
});

test("Calling method on nil interface traps with runtime panic", () => {
	const src = `
package main

type Animal interface {
	Sound() string
}

func Main() string {
	var a Animal
	return a.Sound()
}
`;
	const h = compileHybrid(src);
	let caught = false;
	try {
		const { exports } = runWasm(h.wasm, { stringTable: h.stringTable });
		exports.Main();
	} catch (e) {
		caught = true;
		assertEqual(
			e.message.includes("nil pointer dereference") ||
				e.message.includes("invalid memory address"),
			true,
		);
	}
	assertEqual(caught, true);
});

section("WASM Non-Empty Interfaces — Type Assertions & Switches");

test("Concrete type assertion on non-empty interface (comma-ok and direct)", () => {
	const src = `
package main

type Animal interface {
	Sound() string
}

type Dog struct {
	Name string
}

func (d *Dog) Sound() string {
	return "bark"
}

type Cat struct {
	Name string
}

func (c *Cat) Sound() string {
	return "meow"
}

func Main() int64 {
	var a Animal = &Dog{Name: "Spike"}
	d := a.(*Dog)
	var score int64
	if d.Name == "Spike" {
		score += 10
	}

	d2, ok1 := a.(*Dog)
	if ok1 && d2.Name == "Spike" {
		score += 100
	}

	c, ok2 := a.(*Cat)
	if !ok2 && c == nil {
		score += 1000
	}

	return score
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 1110n);
	assertEqual(wasmRes, jsRes);
});

test("Failed single-value concrete type assertion on interface traps with panic", () => {
	const src = `
package main

type Animal interface {
	Sound() string
}

type Dog struct{}
func (d *Dog) Sound() string { return "bark" }

type Cat struct{}
func (c *Cat) Sound() string { return "meow" }

func Main() string {
	var a Animal = &Dog{}
	c := a.(*Cat)
	return c.Sound()
}
`;
	const h = compileHybrid(src);
	let caught = false;
	try {
		const { exports } = runWasm(h.wasm, { stringTable: h.stringTable });
		exports.Main();
	} catch (e) {
		caught = true;
		assertEqual(
			e.message.includes(
				"interface conversion: main.Animal is *main.Dog, not *main.Cat",
			),
			true,
		);
	}
	assertEqual(caught, true);
});

test("Interface-to-interface type assertion (interface narrowing/conversion)", () => {
	const src = `
package main

type Reader interface {
	Read() string
}

type Closer interface {
	Close() int64
}

type ReadCloser interface {
	Read() string
	Close() int64
}

type MyFile struct {
	Content string
}

func (f *MyFile) Read() string {
	return f.Content
}

func (f *MyFile) Close() int64 {
	return 1
}

func Main() int64 {
	var rc ReadCloser = &MyFile{Content: "data"}
	r, ok1 := rc.(Reader)
	c, ok2 := rc.(Closer)

	var score int64
	if ok1 && r.Read() == "data" {
		score += 100
	}
	if ok2 && c.Close() == 1 {
		score += 20
	}
	return score
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 120n);
	assertEqual(wasmRes, jsRes);
});

test("Type switch on non-empty interface", () => {
	const src = `
package main

type Shape interface {
	Area() int64
}

type Square struct {
	Side int64
}

func (s *Square) Area() int64 {
	return s.Side * s.Side
}

type Circle struct {
	Radius int64
}

func (c *Circle) Area() int64 {
	return 3 * c.Radius * c.Radius
}

func Describe(s Shape) int64 {
	switch v := s.(type) {
	case *Square:
		return 1000 + v.Side
	case *Circle:
		return 2000 + v.Radius
	default:
		return 0
	}
}

func Main() int64 {
	s := &Square{Side: 5}
	c := &Circle{Radius: 10}
	return Describe(s) + Describe(c)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 3015n);
	assertEqual(wasmRes, jsRes);
});

section("WASM Non-Empty Interfaces — Aggregates: Struct Fields & Slices");

test("Interface stored in struct field (like physics.RaycastProvider)", () => {
	const src = `
package main

type RaycastProvider interface {
	Raycast(from, to float32) float32
}

type FlatFloor struct {
	FloorY float32
}

func (f *FlatFloor) Raycast(from, to float32) float32 {
	return f.FloorY
}

type DynamicBody struct {
	Raycast RaycastProvider
	Height  float32
}

func (b *DynamicBody) Step() float32 {
	if b.Raycast != nil {
		return b.Raycast.Raycast(10.0, 0.0) + b.Height
	}
	return 0.0
}

func Main() float32 {
	floor := &FlatFloor{FloorY: 1.5}
	body := &DynamicBody{
		Raycast: floor,
		Height:  2.0,
	}
	return body.Step()
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 3.5);
	assertEqual(wasmRes, jsRes);
});

test("Slice of interfaces iterating and dispatching dynamically", () => {
	const src = `
package main

type Greeter interface {
	Greet() string
}

type Person struct {
	Name string
}

func (p *Person) Greet() string {
	return "Hi " + p.Name
}

type Alien struct {
	Planet string
}

func (a *Alien) Greet() string {
	return "Greetings from " + a.Planet
}

func Main() string {
	list := []Greeter{
		&Person{Name: "Alice"},
		&Alien{Planet: "Mars"},
		&Person{Name: "Bob"},
	}

	var res string
	for i := 0; i < len(list); i++ {
		if i > 0 {
			res = res + ", "
		}
		res = res + list[i].Greet()
	}
	return res
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "Hi Alice, Greetings from Mars, Hi Bob");
	assertEqual(wasmRes, jsRes);
});

test("Interface dispatch skips same-named methods with a different arity", () => {
	const src = `
package main

type Resetter interface {
	Reset()
}

type Counter struct{ n int }

func (c *Counter) Reset() { c.n = 0 }

type Reader struct{ s string }

func (r *Reader) Reset(s string) { r.s = s }

func Main() int {
	c := &Counter{n: 5}
	var r Resetter = c
	r.Reset()
	rd := &Reader{}
	rd.Reset("x")
	return c.n + len(rd.s)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 1);
	assertEqual(wasmRes, jsRes);
});

test("type assertions to a named string, a map and a pointer to an anonymous struct", () => {
	const src = `
package main

type Label string

func Main() string {
	var a any = Label("x")
	l, ok := a.(Label)
	_, isStr := a.(string)
	var s any = "plain"
	_, isLabel := s.(Label)
	var m any = map[string]int{"k": 2}
	mm, isMap := m.(map[string]int)
	anon := &struct{ N int }{5}
	var p any = anon
	pp, isPtr := p.(*struct{ N int })
	if !isPtr {
		return "no pointer"
	}
	return string(l) + " " + boolStr(ok) + boolStr(isStr) + boolStr(isLabel) + boolStr(isMap) + " " + itoa(mm["k"]+pp.N)
}

func boolStr(b bool) string {
	if b {
		return "T"
	}
	return "F"
}

func itoa(n int) string {
	if n == 7 {
		return "7"
	}
	return "?"
}
`;
	// Go's answer: a named string is not a string in an interface.
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "x TFFT 7");
	assertEqual(jsRes, "x TFFT 7");
});

test("type switch tells interfaces with the same method name apart", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type one struct{}

func (one) Error() string { return "one" }
func (one) Unwrap() error { return nil }

type many struct{}

func (many) Error() string   { return "many" }
func (many) Unwrap() []error { return nil }

type plain struct{}

func (plain) Error() string { return "plain" }

func kind(e error) string {
	switch e.(type) {
	case interface{ Unwrap() error }:
		return "single"
	case interface{ Unwrap() []error }:
		return "multi"
	}
	return "none"
}

type Unwrapper interface{ Unwrap() []error }

func named(e error) string {
	switch e.(type) {
	case Unwrapper:
		return "named multi"
	}
	return "named none"
}

func main() {
	fmt.Println(kind(one{}), kind(many{}), kind(plain{}), kind(&many{}), kind(&one{}))
	fmt.Println(named(one{}), named(many{}), named(plain{}))
	var em error = many{}
	_, ok := em.(interface{ Unwrap() []error })
	_, ok2 := em.(interface{ Unwrap() error })
	fmt.Println(ok, ok2)
	var e error = one{}
	switch x := e.(type) {
	case interface{ Unwrap() []error }:
		fmt.Println("multi", x.Unwrap() == nil)
	case interface{ Unwrap() error }:
		fmt.Println("single", x.Unwrap() == nil)
	}
}
`,
		"single multi none multi single\nnamed none named multi named none\ntrue false\nsingle true\n",
	);
});

test("errors.Join matches the multi-error Unwrap interface in JS", () => {
	const src = `package main

import (
	"errors"
	"fmt"
)

func kind(e error) string {
	switch e.(type) {
	case interface{ Unwrap() error }:
		return "single"
	case interface{ Unwrap() []error }:
		return "multi"
	}
	return "none"
}

func main() {
	a, b := errors.New("a"), errors.New("b")
	j := errors.Join(a, b)
	fmt.Println(kind(j), kind(a))
	_, one := j.(interface{ Unwrap() error })
	_, many := j.(interface{ Unwrap() []error })
	fmt.Println(one, many, errors.Is(j, b))
}
`;
	const { js, errors } = compile(src, { target: "both" });
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "multi none\nfalse true true");
});

section("Interfaces — pointers to named scalars and values stored in any");

test("interface dispatch through pointers to named scalars, type switches and any elements", async () => {
	await assertProgramOutput(
		`package main

import (
	"fmt"
	"io"
)

type Getter interface{ Get() int }
type MyInt int

func (m MyInt) Get() int { return int(m) }

type Str string

func (s Str) Name() string { return string(s) }

type Namer interface{ Name() string }

type F float64

func (f F) Size() int { return int(f) }

type Sizer interface{ Size() int }

type W struct{ n int }

func (w *W) Write(p []byte) (int, error) { w.n += len(p); return len(p), nil }

type T struct{ n int }

func (t T) Name() string { return fmt.Sprint("T", t.n) }

func main() {
	var w io.Writer = &W{}
	fmt.Println(w.Write([]byte("xy")))
	var mi MyInt = 42
	var g Getter = &mi
	fmt.Println(g.Get())
	g = mi
	fmt.Println(g.Get())
	s := Str("hello")
	var n Namer = &s
	fmt.Println(n.Name())
	f := F(7.9)
	var sz Sizer = &f
	fmt.Println(sz.Size())
	t := T{4}
	for _, v := range []any{s, &s, 3, &t, t, nil, f, &f} {
		switch x := v.(type) {
		case Namer:
			fmt.Println("namer", x.Name())
		case Sizer:
			fmt.Println("sizer", x.Size())
		case nil:
			fmt.Println("nil")
		default:
			fmt.Println("other")
		}
	}
	vs := []any{t, &t}
	fmt.Println(len(vs))
}
`,
		`2 <nil>
42
42
hello
7
namer hello
namer hello
other
namer T4
namer T4
nil
sizer 7
sizer 7
2
`,
	);
});

test("type switch on any(int64(1)) with case int before case int64 (Task 1.3)", async () => {
	const src = `package main

import "fmt"

func check(x any) string {
	switch x.(type) {
	case int:
		return "int"
	case int64:
		return "int64"
	default:
		return "other"
	}
}

func main() {
	fmt.Println(check(any(int64(1))))
	fmt.Println(check(any(int(1))))
}
`;
	await assertProgramOutput(src, "int64\nint\n");
});

section("WASM interfaces: type switches, identity, typed nil and dispatch");

test("a type switch with case nil and an interface case compiles and matches Go", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func f(err error) string {
	switch err.(type) {
	case nil:
		return "nil"
	case error:
		return "error"
	}
	return "other"
}

func main() {
	fmt.Println(f(nil))
	fmt.Println(f(fmt.Errorf("x")))
}
`,
		"nil\nerror\n",
	);
});

test("case error on an any value matches only errors", async () => {
	await assertProgramOutput(
		`package main

import (
	"errors"
	"fmt"
)

func f(v any) string {
	switch v.(type) {
	case error:
		return "d"
	}
	return "other"
}

func main() {
	fmt.Println(f(errors.New("x")), f(3), f(nil))
}
`,
		"d other other\n",
	);
});

test("a defined string type is distinct from string in a type switch", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type L string

func desc(v any) string {
	switch v.(type) {
	case L:
		return "L"
	case string:
		return "string"
	}
	return "other"
}

func main() {
	fmt.Println(desc(L("a")), desc("a"), desc(3))
}
`,
		"L string other\n",
	);
});

test("a defined string type asserts to itself and not to string", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type L string

func desc(v any) string {
	switch v.(type) {
	case L:
		return "L"
	case string:
		return "string"
	}
	return "other"
}

func main() {
	fmt.Println(desc(L("a")), desc("a"))
	var x any = L("q")
	_, ok := x.(string)
	l, ok2 := x.(L)
	fmt.Println(ok, ok2, l)
}
`,
		"L string\nfalse true q\n",
	);
});

test("a type parameter case matches the defined type it is instantiated with", async () => {
	await assertWasmProgramOutput(
		`package main

import "fmt"

type Name string

func Kind[T any](v T) string {
	switch any(v).(type) {
	case string:
		return "str"
	case T:
		return "T"
	}
	return "other"
}

func Kind2[T any](v T) string {
	switch any(v).(type) {
	case T:
		return "T"
	case string:
		return "str"
	}
	return "other"
}

func main() {
	fmt.Println(Kind[Name](Name("a")), Kind2[Name](Name("a")), Kind("a"))
}
`,
		"T T str\n",
	);
});

test("converting to a defined int8 type parameter wraps like Go", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type Small int8

func conv[T ~int8 | ~int16 | ~int](n int) T { return T(n) }

func main() {
	fmt.Println(conv[Small](130), conv[int16](130))
}
`,
		"-126 130\n",
	);
});

test("a qualified generic type converts and asserts in a wasm package", async () => {
	await assertProgramOutput(
		`package main

import (
	"fmt"
	"iter"
)

func seq(yield func(int) bool) { yield(1) }

func main() {
	var a any = iter.Seq[int](seq)
	_, ok := a.(iter.Seq[int])
	fmt.Println(ok)
}
`,
		"true\n",
	);
});

test("iter.Seq[int] assertion matches an iter.Seq[int] value only", async () => {
	await assertProgramOutput(
		`package main

import (
	"fmt"
	"iter"
)

func seq(yield func(int) bool) { yield(1) }

func main() {
	var s iter.Seq[int] = seq
	var a any = s
	_, ok := a.(iter.Seq[int])
	fmt.Println(ok)
	var n any
	_, ok = n.(iter.Seq[int])
	fmt.Println(ok)
}
`,
		"true\nfalse\n",
	);
});

test("a typed nil pointer in an error interface asserts to error and calls its method", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type E struct{}

func (e *E) Error() string { return "e" }

func main() {
	var err error = (*E)(nil)
	_, ok := any(err).(error)
	fmt.Println(ok, err.Error())
}
`,
		"true e\n",
	);
});

test("a pointer-receiver method handles a nil receiver through an interface", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type T struct{ v int }

func (t *T) PGet() int {
	if t == nil {
		return -1
	}
	return t.v
}

type G interface{ PGet() int }

func main() {
	var p *T
	var g G = p
	fmt.Println(g.PGet())
}
`,
		"-1\n",
	);
});

test("a value method on a nil pointer through an interface panics catchably", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type S struct{ v int }

func (s S) Val() int { return s.v }

type V interface{ Val() int }

func main() {
	defer func() { fmt.Println(recover()) }()
	var p *S
	var v V = p
	fmt.Println(v.Val())
}
`,
		"runtime error: invalid memory address or nil pointer dereference\n",
	);
});

test("nil receivers work through an interface, a method value and a method expression", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type L struct{}

func (l *L) Len() int {
	if l == nil {
		return 0
	}
	return 1
}

type Lener interface{ Len() int }

func main() {
	var nl *L
	var li Lener = nl
	f := nl.Len
	g := (*L).Len
	fmt.Println(li.Len(), f(), g(nl))
}
`,
		"0 0 0\n",
	);
});

test("errors.As finds a typed nil pointer error", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"errors"
	"fmt"
)

type MyErr struct{}

func (e *MyErr) Error() string { return "my" }

func retTyped() error { return (*MyErr)(nil) }

func main() {
	var me *MyErr
	fmt.Println(errors.As(retTyped(), &me))
}
`,
		"true\n",
	);
});

test("interface dispatch on defined func and map types", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type Getter interface{ Get() int }

type MyFn func() int

func (f MyFn) Get() int { return f() }

type MyMap map[string]int

func (m MyMap) Get() int { return len(m) }

func main() {
	f := func() int { return 3 }
	var g Getter = MyFn(f)
	var h Getter = MyMap{"a": 1}
	fmt.Println(g.Get(), h.Get())
}
`,
		"3 1\n",
	);
});

test("a method value taken from an interface value binds its dynamic method", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type N interface{ Name() string }

type A struct{ s string }

func (a *A) Name() string { return a.s }

func main() {
	var n N = &A{"a"}
	f := n.Name
	fmt.Println(f())
}
`,
		"a\n",
	);
});

test("Type switches tell apart slices of small integers, arrays of different lengths and a named string", async () => {
	await assertWasmProgramOutput(
		`package main

import "fmt"

type Name string

func kind(v any) string {
	switch x := v.(type) {
	case []byte:
		return fmt.Sprint("bytes", len(x))
	case []bool:
		return fmt.Sprint("bools", len(x))
	case []rune:
		return fmt.Sprint("runes", len(x))
	case []uint32:
		return fmt.Sprint("u32s", len(x))
	case [3]int:
		return fmt.Sprint("a3", x[2])
	case [2]int:
		return fmt.Sprint("a2", x[1])
	case Name:
		return "name:" + string(x)
	}
	return "other"
}

func main() {
	var a any = []bool{true, false}
	_, isBytes := a.([]byte)
	b, isBools := a.([]bool)
	fmt.Println(kind([]byte("hi")), kind(a), kind([]rune("héé")), kind([]uint32{7}))
	fmt.Println(kind([3]int{1, 2, 3}), kind([2]int{4, 5}), kind(Name("n")), kind(1))
	fmt.Println(isBytes, isBools, len(b))
}
`,
		`bytes2 bools2 runes3 u32s1
a33 a25 name:n other
false true 2
`,
	);
});

section(
	"Dynamic types in any: typed nils, generics, promoted methods, defined types, panics",
);

test("a nil pointer or slice stored in any keeps its dynamic type", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	var p1, p2 *int
	var a1, a2 any = p1, p2
	fmt.Println(a1 == a2)
	var q *string
	var a3 any = q
	fmt.Println(a1 == a3)
	var s []int
	var a any = s
	_, ok := a.([]int)
	fmt.Println(ok)
	_, ok = a.([]string)
	fmt.Println(ok)
	v, _ := a.([]int)
	fmt.Println(v == nil, len(v))
	switch a.(type) {
	case nil:
		fmt.Println("nil")
	case []int:
		fmt.Println("[]int")
	}
	var empty any
	_, ok = empty.([]int)
	fmt.Println(ok)
}
`,
		"true\nfalse\ntrue\nfalse\ntrue 0\n[]int\nfalse\n",
	);
});

test("any(v) inside a generic function boxes by the type argument", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Name string

func (n Name) Hi() string { return "hi " + string(n) }

type Counter int

func (c *Counter) Inc() { *c++ }

type Incer interface{ Inc() }

func IsNil[T any](v T) bool { return any(v) == nil }

func Kind[T any](v T) string {
	switch any(v).(type) {
	case Name:
		return "Name"
	case *int:
		return "*int"
	case int:
		return "int"
	}
	return "other"
}

func Step[T Incer](p T) { p.Inc() }

func main() {
	var p *int
	fmt.Println(IsNil(p), IsNil(Name("a")), IsNil(1))
	fmt.Println(Kind(Name("a")), Kind(p), Kind(2), Kind("s"))
	c := Counter(5)
	Step(&c)
	fmt.Println(c)
}
`,
		"false false false\nName *int int other\n6\n",
	);
});

test("promoted pointer-receiver methods stay out of a struct value's method set and case fmt.Stringer checks String", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"errors"
	"fmt"
	"sort"
)

type Mer interface{ M() }
type Ver interface{ V() }
type Inner struct{}

func (*Inner) M() {}
func (Inner) V()  {}

type Mid struct{ Inner }
type Outer struct{ Mid }
type S struct{}

func (S) String() string { return "S" }

func kind(v any) string {
	switch v.(type) {
	case error:
		return "error"
	case fmt.Stringer:
		return "stringer"
	case sort.Interface:
		return "sorter"
	}
	return "other"
}

func main() {
	var v any = Outer{}
	_, ok := v.(Mer)
	fmt.Println(ok)
	_, ok = v.(Ver)
	fmt.Println(ok)
	v = &Outer{}
	_, ok = v.(Mer)
	fmt.Println(ok)
	v = Mid{}
	_, ok = v.(Mer)
	fmt.Println(ok)
	v = Inner{}
	_, ok = v.(Mer)
	fmt.Println(ok)
	fmt.Println(kind(3), kind("s"), kind(S{}), kind(errors.New("e")), kind(nil))
}
`,
		"false\ntrue\ntrue\nfalse\nfalse\nother other stringer error other\n",
	);
});

test("iter.Seq and defined slice types differ from their unnamed forms in assertions", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"fmt"
	"iter"
)

type S []int
type T []string
type B []byte

func kind(v any) string {
	switch x := v.(type) {
	case S:
		return fmt.Sprint("S", len(x))
	case T:
		return "T"
	case B:
		return "B"
	case []int:
		return fmt.Sprint("slice", len(x))
	case []byte:
		return "bytes"
	}
	return "other"
}

func main() {
	seq := func(yield func(int) bool) { yield(1) }
	var a any = seq
	_, ok := a.(iter.Seq[int])
	fmt.Println(ok)
	fmt.Println(kind(S{1}), kind([]int{1, 2}), kind(T{"a"}), kind(B{1}), kind([]byte{1}))
	switch any([]int{1}).(type) {
	case S:
		fmt.Println("S")
	case []int:
		fmt.Println("slice")
	}
}
`,
		"false\nS1 slice2 T B bytes\nslice\n",
	);
});

test("a defined func or slice type in any is not its unnamed form (wasm)", async () => {
	await assertWasmProgramOutput(
		`package main

import (
	"fmt"
	"iter"
)

type S []int

func main() {
	seq := func(yield func(int) bool) { yield(1) }
	var s iter.Seq[int] = seq
	var a any = s
	_, ok := a.(iter.Seq[int])
	fmt.Println(ok)
	_, ok = a.(func(func(int) bool))
	fmt.Println(ok)
	a = S(nil)
	_, ok = a.(S)
	fmt.Println(ok)
}
`,
		"true\nfalse\ntrue\n",
	);
});

test("a failed type assertion panics with Go's interface conversion message", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"errors"
	"fmt"
)

type I interface{ M() }
type A struct{}
type B struct{}

func (*B) M() {}

type C struct{}

func (*C) M() {}

type N int

func try(f func()) {
	defer func() { fmt.Println(recover().(error).Error()) }()
	f()
}

func main() {
	var a any = "s"
	try(func() { _ = a.(int) })
	a = nil
	try(func() { _ = a.(int) })
	try(func() { _ = a.(I) })
	a = A{}
	try(func() { _ = a.(B) })
	try(func() { _ = a.(*A) })
	try(func() { _ = a.(I) })
	a = &A{}
	try(func() { _ = a.(A) })
	a = N(3)
	try(func() { _ = a.(int) })
	a = 3.5
	try(func() { _ = a.(int) })
	a = []int{1}
	try(func() { _ = a.([]string) })
	var e error = errors.New("x")
	try(func() { _ = e.(I) })
	var i I = &B{}
	try(func() { _ = i.(*C) })
}
`,
		"interface conversion: interface {} is string, not int\ninterface conversion: interface {} is nil, not int\ninterface conversion: interface is nil, not main.I\ninterface conversion: interface {} is main.A, not main.B\ninterface conversion: interface {} is main.A, not *main.A\ninterface conversion: main.A is not main.I: missing method M\ninterface conversion: interface {} is *main.A, not main.A\ninterface conversion: interface {} is main.N, not int\ninterface conversion: interface {} is float64, not int\ninterface conversion: interface {} is []int, not []string\ninterface conversion: *errors.errorString is not main.I: missing method M\ninterface conversion: main.I is *main.B, not *main.C\n",
	);
});

test("JS: a nil slice or func in any or interface{} compares equal to nil, a nil map or pointer does not", () => {
	const src = `
package main

import "fmt"

type S struct{}

func main() {
	var s []int
	var m map[string]int
	var p *int
	var f func()
	var a1, a2, a3, a4 any = s, m, p, f
	var b1, b2, b3, b4 interface{} = s, m, p, f
	fmt.Println(a1 == nil, a2 == nil, a3 == nil, a4 == nil)
	fmt.Println(b1 == nil, b2 == nil, b3 == nil, b4 == nil)
	fmt.Println(b1 != nil)
}
`;
	const { js, errors } = compile(src, { target: "js" });
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true false false true\ntrue false false true\nfalse");
});

section("Promoted methods in interface dispatch");

test("an ambiguous promoted method fails the assertion on every target", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Mer interface{ M() }

type A struct{}

func (A) M() {}

type B struct{}

func (B) M() {}

type C struct {
	A
	B
}

func main() {
	var v any = C{}
	_, ok := v.(Mer)
	fmt.Println(ok)
}
`,
		"false\n",
	);
});

for (const [name, decls] of [
	[
		"a pointer embed",
		'type Inner struct{}\n\nfunc (i *Inner) M() { fmt.Println("inner") }\n\ntype PO struct{ *Inner }',
	],
	[
		"a value embed",
		'type Inner struct{}\n\nfunc (i Inner) M() { fmt.Println("inner") }\n\ntype PO struct{ Inner }',
	],
]) {
	test(`a promoted method call on a nil outer pointer through ${name} is a nil dereference`, async () => {
		await assertAllTargetsOutput(
			`package main

import "fmt"

type Mer interface{ M() }

${decls}

func main() {
	defer func() { fmt.Println(recover()) }()
	var v any = (*PO)(nil)
	v.(Mer).M()
}
`,
			"runtime error: invalid memory address or nil pointer dereference\n",
		);
	});
}

section("Methods promoted from embedded interfaces");

const IFACE_EMBED_PRELUDE = `package main

import "fmt"

type Mer interface{ M() }

type T struct{}

func (T) M() { fmt.Println("T.M") }

type S struct{ Mer }
`;

test("an embedded interface's methods are called directly and through the interface", async () => {
	await assertAllTargetsOutput(
		`${IFACE_EMBED_PRELUDE}
func main() {
	var m Mer = S{T{}}
	m.M()
	S{T{}}.M()
	p := &S{T{}}
	p.M()
	var v any = S{T{}}
	_, ok := v.(Mer)
	fmt.Println(ok)
	v.(Mer).M()
	v = &S{T{}}
	_, ok = v.(Mer)
	fmt.Println(ok)
}
`,
		"T.M\nT.M\nT.M\ntrue\nT.M\ntrue\n",
	);
});

test("an embedded error interface gives the struct an Error method", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"errors"
	"fmt"
)

type W struct{ error }

func main() {
	var e error = W{errors.New("x")}
	fmt.Println(e.Error())
	fmt.Println(W{errors.New("y")}.Error())
	fmt.Println(e)
}
`,
		"x\ny\nx\n",
	);
});

test("embedded interface methods keep their arguments and results", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Adder interface {
	Add(a, b int) int
	Name() string
}

type Calc struct{ base int }

func (c Calc) Add(a, b int) int { return c.base + a + b }
func (c Calc) Name() string      { return "calc" }

type Wrapped struct{ Adder }

type Outer struct{ Wrapped }

func use(a Adder) { fmt.Println(a.Name(), a.Add(1, 2)) }

func main() {
	w := Wrapped{Calc{10}}
	use(w)
	fmt.Println(w.Add(3, 4), w.Name())
	o := Outer{w}
	use(o)
	fmt.Println(o.Add(5, 6), o.Name())
}
`,
		"calc 13\n17 calc\ncalc 13\n21 calc\n",
	);
});

test("a method promoted from a nil embedded interface is a nil dereference", async () => {
	await assertAllTargetsOutput(
		`${IFACE_EMBED_PRELUDE}
func main() {
	defer func() { fmt.Println(recover()) }()
	var m Mer = S{}
	m.M()
}
`,
		"runtime error: invalid memory address or nil pointer dereference\n",
	);
});

test("a method promoted through a nil embedded interface in a direct call is a nil dereference", async () => {
	await assertAllTargetsOutput(
		`${IFACE_EMBED_PRELUDE}
func main() {
	defer func() { fmt.Println(recover()) }()
	S{}.M()
}
`,
		"runtime error: invalid memory address or nil pointer dereference\n",
	);
});

section("Value methods promoted through a nil embedded pointer");

const NIL_EMBED_PRELUDE = `package main

import "fmt"

type VMer interface{ VM() }
`;

for (const [name, inner] of [
	["an empty Inner", "type Inner struct{}"],
	["an Inner with a field", "type Inner struct{ n int }"],
]) {
	test(`a value method through a nil embedded pointer to ${name} panics`, async () => {
		await assertAllTargetsOutput(
			`${NIL_EMBED_PRELUDE}
${inner}

func (i Inner) VM() { fmt.Println("inner") }

type PO struct{ *Inner }

func main() {
	defer func() { fmt.Println(recover()) }()
	var v any = PO{}
	v.(VMer).VM()
}
`,
			"runtime error: invalid memory address or nil pointer dereference\n",
		);
	});
}

test("a value method through a nil pointer two embeds down panics", async () => {
	await assertAllTargetsOutput(
		`${NIL_EMBED_PRELUDE}
type Inner struct{ n int }

func (i Inner) VM() { fmt.Println("inner") }

type PO struct{ *Inner }

type PO2 struct{ PO }

func main() {
	defer func() { fmt.Println(recover()) }()
	var v any = PO2{PO{}}
	v.(VMer).VM()
}
`,
		"runtime error: invalid memory address or nil pointer dereference\n",
	);
});

test("a value method through a non-nil embedded pointer runs", async () => {
	await assertAllTargetsOutput(
		`${NIL_EMBED_PRELUDE}
type Inner struct{ n int }

func (i Inner) VM() { fmt.Println("inner") }

type PO struct{ *Inner }

func main() {
	var v any = PO{&Inner{}}
	v.(VMer).VM()
	var w VMer = &PO{&Inner{}}
	w.VM()
}
`,
		"inner\ninner\n",
	);
});
