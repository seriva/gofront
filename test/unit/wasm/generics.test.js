// test/unit/wasm/generics.test.js
// Tests for Phase H4 Task H4.2: Generics monomorphisation in WASM and JS-strict parity.

import {
	assertEqual,
	assertErrorContains,
	compile,
	compileHybrid,
	compileHybridProject,
	compileWasm,
	runJs,
	runWasm,
	section,
	test,
} from "../helpers.js";

section("WASM Generics — Functions & Instantiation");

test("Identity generic function with int and string", () => {
	const src = `
package main

func Identity[T any](x T) T {
	return x
}

func Main() string {
	a := Identity(42)
	b := Identity("hello")
	if a == 42 && b == "hello" {
		return "ok"
	}
	return "fail"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

test("Pair generic function with multiple type params and multi-value returns", () => {
	const src = `
package main

func Pair[T any, U any](a T, b U) (T, U) {
	return a, b
}

func Main() string {
	x, y := Pair(100, "stars")
	if x == 100 && y == "stars" {
		return "matched"
	}
	return "mismatch"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "matched");
	assertEqual(jsRes, wasmRes);
});

test("Explicit instantiation syntax Identity[int](99)", () => {
	const src = `
package main

func Identity[T any](x T) T {
	return x
}

func Main() int {
	return Identity[int](99)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 99);
	assertEqual(Number(jsRes), Number(wasmRes));
});

test("Multiple generic calls in sequence with different types", () => {
	const src = `
package main

func Wrap[T any](x T) T {
	return x
}

func Main() string {
	a := Wrap(1)
	b := Wrap("two")
	c := Wrap(true)
	if a == 1 && b == "two" && c {
		return "all_good"
	}
	return "fail"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "all_good");
	assertEqual(jsRes, wasmRes);
});

section("WASM Generics — Structs & Methods");

test("Generic struct composite literals and field access", () => {
	const src = `
package main

type Box[T any] struct {
	Value T
}

func Main() string {
	b1 := Box[int]{Value: 42}
	b2 := Box[string]{Value: "world"}
	if b1.Value == 42 && b2.Value == "world" {
		return "boxed"
	}
	return "fail"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "boxed");
	assertEqual(jsRes, wasmRes);
});

test("Generic struct with pointer receiver methods (Stack)", () => {
	const src = `
package main

type Stack[T any] struct {
	items []T
}

func (s *Stack[T]) Push(v T) {
	s.items = append(s.items, v)
}

func (s *Stack[T]) Peek() T {
	return s.items[len(s.items)-1]
}

func (s *Stack[T]) Size() int {
	return len(s.items)
}

func Main() int {
	s := Stack[int]{items: []int{}}
	s.Push(10)
	s.Push(20)
	s.Push(30)
	if s.Size() == 3 {
		return s.Peek()
	}
	return -1
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 30);
	assertEqual(Number(jsRes), Number(wasmRes));
});

test("Generic struct with value receiver method", () => {
	const src = `
package main

type Holder[T any] struct {
	Val T
}

func (h Holder[T]) Get() T {
	return h.Val
}

func Main() string {
	h := Holder[string]{Val: "gold"}
	return h.Get()
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "gold");
	assertEqual(jsRes, wasmRes);
});

test("Nested generic structs Box[Box[int]]", () => {
	const src = `
package main

type Box[T any] struct {
	Value T
}

func Main() int {
	inner := Box[int]{Value: 77}
	outer := Box[Box[int]]{Value: inner}
	return outer.Value.Value
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 77);
	assertEqual(Number(jsRes), Number(wasmRes));
});

test("Slice of generic structs", () => {
	const src = `
package main

type Pair[T any, U any] struct {
	Key   T
	Value U
}

func Main() string {
	pairs := []Pair[string, int]{
		Pair[string, int]{Key: "a", Value: 1},
		Pair[string, int]{Key: "b", Value: 2},
	}
	if len(pairs) == 2 && pairs[0].Key == "a" && pairs[1].Value == 2 {
		return "pairs_ok"
	}
	return "fail"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "pairs_ok");
	assertEqual(jsRes, wasmRes);
});

section("WASM Generics — Higher-Order Functions & Slices");

test("Generic Filter with closure predicate", () => {
	const src = `
package main

func Filter[T any](items []T, pred func(T) bool) []T {
	var out []T
	for _, item := range items {
		if pred(item) {
			out = append(out, item)
		}
	}
	return out
}

func Main() int {
	nums := []int{1, 2, 3, 4, 5, 6}
	evens := Filter(nums, func(n int) bool { return n%2 == 0 })
	sum := 0
	for _, n := range evens {
		sum += n
	}
	return sum
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 12);
	assertEqual(Number(jsRes), Number(wasmRes));
});

test("Generic Map transforming slice types T -> U", () => {
	const src = `
package main

func Map[T any, U any](items []T, f func(T) U) []U {
	var out []U
	for _, item := range items {
		out = append(out, f(item))
	}
	return out
}

func Main() string {
	nums := []int{1, 2, 3}
	words := Map(nums, func(n int) string {
		if n == 1 {
			return "one"
		}
		if n == 2 {
			return "two"
		}
		return "three"
	})
	res := ""
	for _, w := range words {
		res += w + ","
	}
	return res
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "one,two,three,");
	assertEqual(jsRes, wasmRes);
});

test("Generic Reduce accumulator", () => {
	const src = `
package main

func Reduce[T any, U any](items []T, init U, f func(U, T) U) U {
	acc := init
	for _, item := range items {
		acc = f(acc, item)
	}
	return acc
}

func Main() int {
	items := []int{1, 2, 3, 4}
	return Reduce(items, 10, func(acc int, n int) int { return acc + n })
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 20);
	assertEqual(Number(jsRes), Number(wasmRes));
});

test("Generic function returning slice Repeat[T]", () => {
	const src = `
package main

func Repeat[T any](x T, n int) []T {
	var out []T
	for i := 0; i < n; i++ {
		out = append(out, x)
	}
	return out
}

func Main() int {
	strs := Repeat("go", 5)
	return len(strs)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 5);
	assertEqual(Number(jsRes), Number(wasmRes));
});

test("Generic function passed as closure value to another function", () => {
	const src = `
package main

func Identity[T any](x T) T {
	return x
}

func Apply(f func(int) int, x int) int {
	return f(x)
}

func Main() int {
	return Apply(Identity[int], 99)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 99);
	assertEqual(Number(jsRes), Number(wasmRes));
});

section("WASM Generics — Constraints & Type Assertions");

test("Comparable constraint Equal[T comparable]", () => {
	const src = `
package main

func Equal[T comparable](a T, b T) bool {
	return a == b
}

func Main() string {
	b1 := Equal(1, 1)
	b2 := Equal(1, 2)
	b3 := Equal("hello", "hello")
	b4 := Equal("hello", "world")
	if b1 && !b2 && b3 && !b4 {
		return "comparable_ok"
	}
	return "fail"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "comparable_ok");
	assertEqual(jsRes, wasmRes);
});

test("Interface constraint Show[T Stringer]", () => {
	const src = `
package main

type Stringer interface {
	String() string
}

type Name struct {
	first string
}

func (n Name) String() string {
	return n.first
}

func Show[T Stringer](x T) string {
	return x.String()
}

func Main() string {
	return Show(Name{first: "Alice"})
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "Alice");
	assertEqual(jsRes, wasmRes);
});

test("Union constraint Add[T Addable] with ~int | ~string", () => {
	const src = `
package main

type Addable interface {
	~int | ~string
}

func Add[T Addable](a T, b T) T {
	return a + b
}

func Main() string {
	n := Add(10, 20)
	s := Add("foo", "bar")
	if n == 30 && s == "foobar" {
		return "union_ok"
	}
	return "fail"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "union_ok");
	assertEqual(jsRes, wasmRes);
});

test("Type assertion on generic struct boxed in any (hybrid parity)", () => {
	const src = `
package main

type Box[T any] struct {
	Value T
}

func Main() string {
	var a any = Box[int]{Value: 42}
	b, ok := a.(Box[int])
	_, notOk := a.(int)
	if ok && !notOk && b.Value == 42 {
		return "assert_ok"
	}
	return "fail"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "assert_ok");
	assertEqual(jsRes, wasmRes);
});

test("WASM strict distinction between Box[int] and Box[string] in assertions and type switches", () => {
	const src = `
package main

type Box[T any] struct {
	Value T
}

func Inspect(x any) string {
	switch v := x.(type) {
	case Box[int]:
		if v.Value == 10 {
			return "box_int"
		}
		return "box_int_other"
	case Box[string]:
		return "box_string:" + v.Value
	default:
		return "unknown"
	}
}

func Main() string {
	var a any = Box[int]{Value: 42}
	_, okInt := a.(Box[int])
	_, okStr := a.(Box[string])
	s1 := Inspect(Box[int]{Value: 10})
	s2 := Inspect(Box[string]{Value: "hi"})
	s3 := Inspect(123)
	if okInt && !okStr && s1 == "box_int" && s2 == "box_string:hi" && s3 == "unknown" {
		return "wasm_monomorph_strict"
	}
	return "fail"
}
`;
	const { wasm, stringTable } = compileWasm(src);
	const { exports } = runWasm(wasm, { stringTable });
	const res = exports.Main();
	assertEqual(res, "wasm_monomorph_strict");
});

// ── Task 0.3 — Generic Named Func Types ───────────────────────

section("WASM Generics — Generic Named Func Types (Task 0.3)");

test("function returning Seq[int] ranged over in a parity test", () => {
	const src = `
package main

type Seq[V any] func(yield func(V) bool)

func Count() Seq[int] {
	return func(yield func(int) bool) {
		if !yield(10) { return }
		if !yield(20) { return }
		if !yield(30) { return }
	}
}

func Main() int {
	sum := 0
	for v := range Count() {
		sum += v
	}
	return sum
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 60n);
	assertEqual(Number(jsRes), 60);
});

test("generic Map[A, B any](s Seq[A], f func(A) B) Seq[B]", () => {
	const src = `
package main

type Seq[V any] func(yield func(V) bool)

func FromSlice[T any](xs []T) Seq[T] {
	return func(yield func(T) bool) {
		for _, x := range xs {
			if !yield(x) { return }
		}
	}
}

func Map[A, B any](s Seq[A], f func(A) B) Seq[B] {
	return func(yield func(B) bool) {
		for a := range s {
			if !yield(f(a)) { return }
		}
	}
}

func Main() int {
	xs := []int{1, 2, 3}
	double := func(x int) int { return x * 2 }
	sum := 0
	for v := range Map(FromSlice(xs), double) {
		sum += v
	}
	return sum
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 12n);
	assertEqual(Number(jsRes), 12);
});

section("WASM Generics — Generic Calls Inside Generic Bodies");

test("generic function calling another generic with its type parameter", () => {
	const src = `
package main

type Number interface { ~int | ~float64 }

func less[T Number](a, b T) bool { return a < b }

func Max[T Number](a, b T) T {
	if less(a, b) {
		return b
	}
	return a
}

func Main() float64 {
	return float64(Max(3, 7)) + Max(2.5, 1.5)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 9.5);
	assertEqual(jsRes, wasmRes);
});

test("linked wasm program with generics and a cross-package call", async () => {
	const res = await compileHybridProject({
		"util/util.go": `//gofront:target both
package util

func Two() int { return 2 }

func Id[T any](x T) T { return x }
`,
		"lib/lib.go": `//gofront:target wasm
package lib

import "../util"

func Run() int { return util.Two() + util.Id(40) }
`,
		"main.go": `package main

import "./lib"

func main() { println(lib.Run()) }
`,
	});
	assertEqual(res.lines.join("\n"), "42");
});

section("Generic zero values and type-parameter operators (Task 0.18)");

// Builds \`lib\` once as \`both\` (JS code path) and once as \`wasm\`, prints
// \`lib.Run()\` from a JS root and throws when the two backends disagree.
async function libParity(libBody) {
	const run = async (target) => {
		const res = await compileHybridProject({
			"lib/lib.go": `//gofront:target ${target}\npackage lib\n\n${libBody}`,
			"main.go": `package main\n\nimport "./lib"\n\nfunc main() { println(lib.Run()) }\n`,
		});
		return res.lines.join("\n");
	};
	const js = await run("both");
	const wasm = await run("wasm");
	if (js !== wasm)
		throw new Error(
			`Output mismatch:\n  JS:   ${JSON.stringify(js)}\n  WASM: ${JSON.stringify(wasm)}`,
		);
	return js;
}

test('cmp.Or("", "x") and cmp.Or(0, 3) skip zero values', async () => {
	const out = await libParity(`import (
	"cmp"
	"fmt"
)

func Run() string {
	return fmt.Sprintf("%s|%d|%q|%d", cmp.Or("", "x"), cmp.Or(0, 3), cmp.Or("", ""), cmp.Or(0, 0))
}
`);
	assertEqual(out, 'x|3|""|0');
});

const STACK = `
type Stack[T any] struct {
	items []T
}

func (s *Stack[T]) Push(v T) { s.items = append(s.items, v) }

func (s *Stack[T]) Pop() (T, bool) {
	var zero T
	if len(s.items) == 0 {
		return zero, false
	}
	v := s.items[len(s.items)-1]
	s.items = s.items[:len(s.items)-1]
	return v, true
}
`;

test("Stack[int].Pop on an empty stack returns 0", () => {
	const src = `
package main
${STACK}
func Main() int {
	s := &Stack[int]{}
	s.Push(4)
	a, _ := s.Pop()
	b, ok := s.Pop()
	var t Stack[string]
	c, _ := t.Pop()
	if ok || c != "" {
		return -1
	}
	return a*10 + b
}
`;
	const { wasmRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 40);
});

test("Stack[int].Pop through an interface returns 0", () => {
	const src = `
package main

import "fmt"
${STACK}

type IntPopper interface {
	Pop() (int, bool)
}

func Main() {
	var p IntPopper = &Stack[int]{}
	v, ok := p.Pop()
	fmt.Println(v, ok)
}
`;
	const { output } = compileHybrid(src).run("Main");
	assertEqual(output, "0 false");
});

test("Abs[T Number](x T) T using -x", () => {
	const src = `
package main

import "fmt"

type Number interface {
	~int | ~int64 | ~float64
}

func Abs[T Number](x T) T {
	if x < 0 {
		return -x
	}
	return +x
}

func Main() {
	fmt.Println(Abs(-3), Abs(2), Abs(int64(-5)), Abs(-1.5))
}
`;
	const { output } = compileHybrid(src).run("Main");
	assertEqual(output, "3 2 5 1.5");
});

test("^x on an integer type parameter", () => {
	const src = `
package main

type Signed interface {
	~int | ~int32
}

func Flip[T Signed](x T) T { return ^x }

func Main() int {
	return Flip(5) + int(Flip(int32(-1)))
}
`;
	const { wasmRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), -6);
});

test("[2]T zero value in a generic body", () => {
	const src = `
package main

import "fmt"

type Point struct {
	X, Y int
}

func Pair[T any]() [2]T {
	var a [2]T
	return a
}

func Main() {
	p := Pair[Point]()
	p[0].X = 5
	fmt.Println(p[0].X, p[1].X, Pair[bool]()[0], Pair[float64]()[1])
}
`;
	const { output } = compileHybrid(src).run("Main");
	assertEqual(output, "5 0 false 0");
});

// JS only: WASM monomorphisation does not substitute T in \`new(T)\` and drops
// named results when it copies a generic body (both fail to compile there).
test("*new(T), named results and recovered results are zero in JS", () => {
	const { js, errors } = compile(
		`
package main

import "fmt"

type Point struct {
	X, Y int
}

func NewZero[T any]() T { return *new(T) }

func Named[T any]() (r T, ok bool) { return }

func Recovered[T any]() T {
	defer func() { recover() }()
	panic("boom")
}

func main() {
	a, _ := Named[float64]()
	b, ok := Named[Point]()
	fmt.Println(NewZero[int](), NewZero[string]() == "", NewZero[Point]().X, a, b.X, ok, Recovered[int](), Recovered[bool]())
}
`,
		{ strict: true },
	);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0 true 0 0 0 false 0 false");
});

test("generic body forwards its type parameter's zero value", () => {
	const src = `
package main

import "fmt"

func Zero[T any]() T {
	var z T
	return z
}

func Wrap[T any]() T { return Zero[T]() }

func Apply(f func() int) int { return f() }

func Main() {
	fmt.Println(Wrap[int](), Apply(Zero[int]), len(Wrap[string]()), Wrap[bool]())
}
`;
	const { output } = compileHybrid(src).run("Main");
	assertEqual(output, "0 0 0 false");
});

test("generic struct fields of type T start at T's zero value", () => {
	const src = `
package main

import "fmt"

type Box[T any] struct {
	V T
	N int
}

func (b Box[T]) Get() T { return b.V }

func Main() {
	var a Box[int]
	b := Box[int]{N: 2}
	c := &Box[string]{}
	fmt.Println(a.V, b.Get(), b.N, c.Get() == "", len(c.V))
}
`;
	const { output } = compileHybrid(src).run("Main");
	assertEqual(output, "0 0 2 true 0");
});

test("unary - on a non-numeric type parameter is rejected", () => {
	const { errors } = compile(`
package main

func Neg[T ~string](x T) T { return -x }
`);
	assertErrorContains(errors, "- requires numeric");
});

test("unary ^ on a float type parameter is rejected", () => {
	const { errors } = compile(`
package main

type Float interface {
	~float32 | ~float64
}

func Flip[T Float](x T) T { return ^x }
`);
	assertErrorContains(errors, "^ requires integer");
});

test("unary ^, - and + on a type parameter whose constraint embeds a type set", () => {
	const src = `
package main

import "fmt"

type Integer interface{ ~int | ~int64 }

type Num2 interface{ Integer }

type Num3 interface {
	Integer
	String() string
}

type MyInt int

func (m MyInt) String() string { return "m" }

func B[T Num2](x T) T { return ^x }

func E[T Num3](x T) T { return ^x }

func G[T interface{ Integer }](x T) T { return ^x }

func N[T Num2](x T) T { return -x }

func P[T Num2](x T) T { return +x }

func Main() {
	fmt.Println(B(2), int(E(MyInt(3))), G(int64(4)), N(7), P(8))
}
`;
	const { output } = compileHybrid(src).run("Main");
	assertEqual(output, "-3 -4 -5 -7 8");
});

test("unary operators on type parameters reject constraints outside their type set", () => {
	const cases = [
		["func F[T ~int | ~string](x T) T { return -x }", "- requires numeric"],
		["func F[T ~float64 | ~int](x T) T { return ^x }", "^ requires integer"],
		["func F[T any](x T) T { return +x }", "+ requires numeric"],
		["func F[T comparable](x T) T { return ^x }", "^ requires integer"],
		[
			"type Mixed interface{ ~int | ~string }\ntype Wrap interface{ Mixed }\nfunc F[T Wrap](x T) T { return -x }",
			"- requires numeric",
		],
	];
	for (const [decl, msg] of cases) {
		const { errors } = compile(`package main\n\n${decl}\n`);
		assertErrorContains(errors, msg);
	}
});

// JS only: WASM does not support partial explicit instantiation (pre-existing).
test("partial explicit instantiation infers the remaining type arguments in JS", () => {
	const { js, errors } = compile(
		`
package main

import "fmt"

func Two[A, B any](b B) (A, B) {
	var a A
	var bb B
	return a, bb
}

func Conv[U, T any](x T) U {
	var u U
	return u
}

func main() {
	a, b := Two[int](true)
	fmt.Println(a, b)
	fmt.Println(Conv[int]("a"), Conv[string](1) == "")
}
`,
		{ strict: true },
	);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0 false\n0 true");
});
