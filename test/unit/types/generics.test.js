// GoFront test suite — generics (type parameters, inference, constraints)

import { fileURLToPath } from "node:url";
import {
	assert,
	assertEqual,
	assertErrorContains,
	compile,
	Lexer,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

// ═════════════════════════════════════════════════════════════
// Phase 1–2: Lexer and parser structure
// ═════════════════════════════════════════════════════════════

section("Generics — Lexer & Parser");

test("lexer emits TILDE token for ~", () => {
	const tokens = new Lexer("package main\nvar x = ~0", "test.go").tokenize();
	const tilde = tokens.find((t) => t.value === "~");
	assert(tilde, "expected TILDE token");
});

test("generic function declaration parses without error", () => {
	const { js, errors } = compile(`package main
func Identity[T any](x T) T {
	return x
}
func main() {
	console.log(Identity(42))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42");
});

test("generic function with multiple type params", () => {
	const { js, errors } = compile(`package main
func Pair[T any, U any](a T, b U) (T, U) {
	return a, b
}
func main() {
	x, y := Pair(1, "hello")
	console.log(x, y)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1 hello");
});

test("generic struct declaration and usage", () => {
	const { js, errors } = compile(`package main
type Box[T any] struct {
	Value T
}
func main() {
	b := Box[int]{Value: 42}
	console.log(b.Value)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42");
});

// ═════════════════════════════════════════════════════════════
// Phase 3: Call-site disambiguation
// ═════════════════════════════════════════════════════════════

section("Generics — Disambiguation");

test("Foo[0] is parsed as index expression, not type args", () => {
	const { js, errors } = compile(`package main
func main() {
	Foo := []int{10, 20, 30}
	console.log(Foo[0])
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "10");
});

test("a[b[0]] is parsed as nested index, not type args", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []int{2}
	a := []int{0, 0, 42}
	console.log(a[b[0]])
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42");
});

test("explicit type args: Foo[int](42)", () => {
	const { js, errors } = compile(`package main
func Identity[T any](x T) T {
	return x
}
func main() {
	console.log(Identity[int](42))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42");
});

test("generic composite literal: Box[string]{}", () => {
	const { js, errors } = compile(`package main
type Box[T any] struct {
	Value T
}
func main() {
	b := Box[string]{Value: "hi"}
	console.log(b.Value)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hi");
});

// ═════════════════════════════════════════════════════════════
// Phase 4–5: TypeChecker — compilation without errors
// ═════════════════════════════════════════════════════════════

section("Generics — Type checking");

test("generic func with any constraint compiles", () => {
	const { errors } = compile(`package main
func Wrap[T any](x T) T { return x }
func main() {
	_ = Wrap(42)
}`);
	assertEqual(errors.length, 0);
});

test("generic func body type-checks with T in scope", () => {
	const { js, errors } = compile(`package main
func First[T any](items []T) T {
	return items[0]
}
func main() {
	console.log(First([]int{10, 20}))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "10");
});

test("generic struct with method", () => {
	const { js, errors } = compile(`package main
type Stack[T any] struct {
	items []T
}
func (s *Stack[T]) Push(v T) {
	s.items = append(s.items, v)
}
func (s *Stack[T]) Peek() T {
	return s.items[len(s.items)-1]
}
func main() {
	s := Stack[int]{items: []int{}}
	s.Push(10)
	s.Push(20)
	console.log(s.Peek())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "20");
});

// ═════════════════════════════════════════════════════════════
// Phase 6: Type inference and constraints
// ═════════════════════════════════════════════════════════════

section("Generics — Inference & constraints");

test("type inference: Identity(42) infers T=int", () => {
	const { js, errors } = compile(`package main
func Identity[T any](x T) T { return x }
func main() {
	result := Identity(42)
	console.log(result + 1)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "43");
});

test("type inference: Map function infers T and U", () => {
	const { js, errors } = compile(`package main
func Map[T any, U any](items []T, f func(T) U) []U {
	var out []U
	for _, item := range items {
		out = append(out, f(item))
	}
	return out
}
func main() {
	nums := []int{1, 2, 3}
	strs := Map(nums, func(n int) string { return fmt.Sprintf("%d!", n) })
	for _, s := range strs {
		console.log(s)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1!\n2!\n3!");
});

test("type inference with string type", () => {
	const { js, errors } = compile(`package main
func Repeat[T any](x T, n int) []T {
	var out []T
	for i := 0; i < n; i++ {
		out = append(out, x)
	}
	return out
}
func main() {
	words := Repeat("go", 3)
	console.log(len(words))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3");
});

test("comparable constraint compiles", () => {
	const { js, errors } = compile(`package main
func Equal[T comparable](a T, b T) bool {
	return a == b
}
func main() {
	console.log(Equal(1, 1))
	console.log(Equal("a", "b"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("interface constraint satisfied", () => {
	const { js, errors } = compile(`package main
type Stringer interface {
	String() string
}
type Name struct { first string }
func (n Name) String() string { return n.first }
func Show[T Stringer](x T) string {
	return x.String()
}
func main() {
	console.log(Show(Name{first: "Alice"}))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "Alice");
});

test("constraint violation produces type error", () => {
	const { errors } = compile(`package main
type Stringer interface {
	String() string
}
func Show[T Stringer](x T) string {
	return x.String()
}
func main() {
	Show(42)
}`);
	assertErrorContains(errors, "does not satisfy constraint");
});

// ═════════════════════════════════════════════════════════════
// Phase 7: End-to-end output
// ═════════════════════════════════════════════════════════════

section("Generics — End-to-end");

test("Filter generic function", () => {
	const { js, errors } = compile(`package main
func Filter[T any](items []T, pred func(T) bool) []T {
	var out []T
	for _, item := range items {
		if pred(item) {
			out = append(out, item)
		}
	}
	return out
}
func main() {
	nums := []int{1, 2, 3, 4, 5, 6}
	evens := Filter(nums, func(n int) bool { return n % 2 == 0 })
	for _, n := range evens {
		console.log(n)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "2\n4\n6");
});

test("Reduce generic function", () => {
	const { js, errors } = compile(`package main
func Reduce[T any, U any](items []T, init U, f func(U, T) U) U {
	acc := init
	for _, item := range items {
		acc = f(acc, item)
	}
	return acc
}
func main() {
	sum := Reduce([]int{1, 2, 3, 4}, 0, func(acc int, n int) int { return acc + n })
	console.log(sum)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "10");
});

test("generic struct with explicit instantiation", () => {
	const { js, errors } = compile(`package main
type Pair[T any, U any] struct {
	First  T
	Second U
}
func main() {
	p := Pair[int, string]{First: 42, Second: "hello"}
	console.log(p.First, p.Second)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42 hello");
});

test("generic function passed as value", () => {
	const { js, errors } = compile(`package main
func Identity[T any](x T) T { return x }
func Apply(f func(int) int, x int) int { return f(x) }
func main() {
	console.log(Apply(Identity[int], 99))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "99");
});

test("multiple generic calls in sequence", () => {
	const { js, errors } = compile(`package main
func Wrap[T any](x T) T { return x }
func main() {
	a := Wrap(1)
	b := Wrap("two")
	c := Wrap(true)
	console.log(a, b, c)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1 two true");
});

test("union constraint ~int | ~string", () => {
	const { js, errors } = compile(`package main
type Addable interface {
	~int | ~string
}
func Add[T Addable](a T, b T) T {
	return a + b
}
func main() {
	console.log(Add(3, 4))
	console.log(Add("hello", " world"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "7\nhello world");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
