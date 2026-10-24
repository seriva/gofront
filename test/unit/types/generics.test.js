// GoFront test suite — generics (type parameters, inference, constraints)

import { fileURLToPath } from "node:url";
import {
	assert,
	assertEqual,
	assertErrorContains,
	compile,
	compileHybrid,
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

test("f(a[lowerVar]) is an index expression, not a generic type arg", () => {
	const { js, errors } = compile(`package main
func double(x int) int { return x * 2 }
func main() {
	items := []int{10, 20, 30}
	idx := 2
	console.log(double(items[idx]))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "60");
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

test("generic function with user-defined type arg in argument position", () => {
	const { js, errors } = compile(`package main
type MyNum struct { N int }
func Identity[T any](x T) T { return x }
func Apply(f func(MyNum) MyNum, x MyNum) MyNum { return f(x) }
func main() {
	result := Apply(Identity[MyNum], MyNum{N: 5})
	console.log(result.N)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5");
});

test("user-defined type arg before rparen in call", () => {
	const { js, errors } = compile(`package main
type MyStr struct { S string }
func Identity[T any](x T) T { return x }
func Take(f func(MyStr) MyStr) string {
	result := f(MyStr{S: "hello"})
	return result.S
}
func main() {
	console.log(Take(Identity[MyStr]))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello");
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

test("named-type union constraint satisfied when arg matches term", () => {
	const { errors } = compile(`package main
type Cat struct{}
type Dog struct{}
type Pet interface { Cat | Dog }
func adopt[T Pet](p T) {}
func main() { adopt(Cat{}) }`);
	assertEqual(errors.length, 0);
});

test("named-type union constraint violated when arg does not match", () => {
	const { errors } = compile(`package main
type Cat struct{}
type Dog struct{}
type Pet interface { Cat | Dog }
func adopt[T Pet](p T) {}
type Fish struct{}
func main() { adopt(Fish{}) }`);
	assertErrorContains(errors, "does not satisfy constraint");
});

test("approx constraint (~int) accepts any type — no error", () => {
	const { errors } = compile(`package main
type Num interface { ~int }
func double[T Num](v T) T { return v + v }
func main() { console.log(double(7)) }`);
	assertEqual(errors.length, 0);
});

test("No method error when calling undefined method on interface variable", () => {
	const { errors } = compile(`package main
type Reader interface { Read() string }
func consume(r Reader) {
  r.Write("x")
}
func main() {}`);
	assertErrorContains(errors, "No method");
});

test("slice indexed by uppercase field selector as call arg is an index, not type args", () => {
	const { js, errors } = compile(`package main
type D struct{ Parent int }
type Mat = []float32
func first(m Mat) float32 { return m[0] }
func main() {
	gm := make([]Mat, 2)
	gm[1] = Mat{7}
	d := D{Parent: 1}
	console.log(first(gm[d.Parent]), len(gm[d.Parent]))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "7 1");
});

// ═════════════════════════════════════════════════════════════
// Generic type aliases (Go 1.24, Task 0.14)
// ═════════════════════════════════════════════════════════════

section("Generics — Type aliases");

test("generic alias of a map used as a composite literal (parity)", () => {
	const h = compileHybrid(`package main
type Set[T comparable] = map[T]struct{}
func Main() int {
	s := Set[int]{1: {}, 2: {}}
	s[3] = struct{}{}
	_, ok := s[2]
	_, missing := s[9]
	n := 0
	if ok { n += 100 }
	if missing { n += 10 }
	return len(s)*1000 + n
}`);
	assertEqual(Number(h.run("Main").wasmRes), 3100);
});

test("generic alias as a parameter type is identical to the aliased type", () => {
	const h = compileHybrid(`package main
type Set[T comparable] = map[T]struct{}
func count[K comparable](s Set[K]) int { return len(s) }
func size(s map[string]struct{}) int { return len(s) }
func Main() int {
	s := Set[string]{"a": {}}
	var m map[string]struct{} = s
	ints := map[int]struct{}{1: {}, 2: {}}
	return count(s)*10 + size(m) + count(ints)*100
}`);
	assertEqual(Number(h.run("Main").wasmRes), 211);
});

test("generic alias as the value of a map keyed by another generic's parameter", () => {
	const h = compileHybrid(`package main
type Set[T comparable] = map[T]struct{}
type Graph[K comparable] struct { adj map[K]Set[K] }
func (g *Graph[K]) Add(a, b K) {
	if _, ok := g.adj[a]; !ok { g.adj[a] = Set[K]{} }
	g.adj[a][b] = struct{}{}
}
func Main() int {
	g := &Graph[string]{adj: map[string]Set[string]{}}
	g.Add("a", "b")
	g.Add("a", "c")
	g.Add("b", "c")
	return len(g.adj)*10 + len(g.adj["a"])
}`);
	assertEqual(Number(h.run("Main").wasmRes), 22);
});

test("generic alias of a generic struct keeps the struct's identity and methods", () => {
	const h = compileHybrid(`package main
type Box[T any] struct { Val T }
func (b Box[T]) Get() T { return b.Val }
type Alias[T any] = Box[T]
func unwrap(b Box[int]) int { return b.Get() }
func Main() int {
	a := Alias[int]{Val: 42}
	var b Box[int] = a
	return unwrap(a) + b.Val
}`);
	assertEqual(Number(h.run("Main").wasmRes), 84);
});

test("generic alias of an anonymous struct with a positional literal", () => {
	const h = compileHybrid(`package main
type Pair[T any] = struct{ A, B T }
func sum(p struct{ A, B int }) int { return p.A + p.B }
func Main() int {
	p := Pair[int]{3, 4}
	q := p
	q.A = 9
	k := Pair[int]{B: 5}
	return p.A*1000 + p.B*100 + sum(q)*10 + k.A + k.B
}`);
	assertEqual(Number(h.run("Main").wasmRes), 3535);
});

test("generic alias with swapped parameters substitutes in order", () => {
	const h = compileHybrid(`package main
type KV[K comparable, V any] struct { K K; V V }
type VK[V any, K comparable] = KV[K, V]
func Main() int {
	x := VK[int, string]{K: "a", V: 7}
	var y KV[string, int] = x
	return y.V + len(y.K)*10
}`);
	assertEqual(Number(h.run("Main").wasmRes), 17);
});

test("generic alias with the wrong number of type arguments is an error", () => {
	const { errors } = compile(`package main
type Set[T comparable] = map[T]struct{}
func main() { s := Set[int, string]{}; _ = s }`);
	assertErrorContains(
		errors,
		"got 2 type arguments but Set has 1 type parameters",
	);
});

test("generic alias does not hit the CompositeLit internal error", () => {
	const h = compileHybrid(`package main
type Box[T any] struct { Val T }
type Alias[T any] = Box[T]
func Main() int { b := Alias[int]{Val: 42}; return b.Val }`);
	assertEqual(Number(h.run("Main").wasmRes), 42);
});

test("methods survive on the result of a generic constructor call", () => {
	const decls = `package main
import "fmt"
type Stack[T any] struct{ items []T }
func NewStack[T any](x T) *Stack[T] { return &Stack[T]{items: []T{x}} }
func (s *Stack[T]) Push(x T) { s.items = append(s.items, x) }
func (s *Stack[T]) Len() int { return len(s.items) }
type Box[T any] struct{ v T }
func NewBox[T any](x T) Box[T] { return Box[T]{v: x} }
func (b Box[T]) Get() T { return b.v }
`;
	const bodies = [
		"a := NewStack(1); a.Push(2); fmt.Println(a.Len())",
		"a := NewStack[int](3); a.Push(2); fmt.Println(a.Len())",
		"b := NewBox(7); fmt.Println(b.Get())",
		"b := NewBox[int](7); fmt.Println(b.Get())",
	];
	const expected = ["2", "2", "7", "7"];
	bodies.forEach((body, i) => {
		const { js, errors } = compile(`${decls}func main() { ${body} }`);
		assertEqual(errors.length, 0, errors.map((e) => e.message).join("; "));
		assertEqual(runJs(js), expected[i]);
	});
});

test("generic constructor results satisfy interfaces", () => {
	const decls = `package main
import "fmt"
type Stack[T any] struct{ items []T }
func NewStack[T any](x T) *Stack[T] { return &Stack[T]{items: []T{x}} }
func (s *Stack[T]) Len() int { return len(s.items) }
type Box[T any] struct{ v T }
func NewBox[T any](x T) Box[T] { return Box[T]{v: x} }
func (b Box[T]) Get() T { return b.v }
type Lener interface{ Len() int }
type Getter interface{ Get() string }
func show(l Lener) { fmt.Println(l.Len()) }
func showG[T Lener](l T) { fmt.Println(l.Len()) }
`;
	const bodies = [
		"s := NewStack(1); show(s)",
		"show(NewStack[int](1))",
		"var i Lener = NewStack(1); fmt.Println(i.Len())",
		"var i interface{ Len() int } = NewStack[int](1); fmt.Println(i.Len())",
		"showG(NewStack(1))",
		'var g Getter = NewBox("a"); fmt.Println(len(g.Get()))',
		'var g Getter = NewBox[string]("a"); fmt.Println(len(g.Get()))',
	];
	bodies.forEach((body) => {
		const { js, errors } = compile(`${decls}func main() { ${body} }`);
		assertEqual(
			errors.length,
			0,
			`${body}: ${errors.map((e) => e.message).join("; ")}`,
		);
		assertEqual(runJs(js), "1");
	});
});

test("methods on generic non-struct named types keep baseline errors", () => {
	const cases = [
		{
			decls: `type List[T any] []T
func (l List[T]) Len() int { return len(l) }
func MkList[T any](x T) List[T] { return List[T]{x} }
type L interface{ Len() int }`,
			bodies: [
				["fmt.Println(List[int]{1, 2}.Len())", "has no field or method 'Len'"],
				["fmt.Println(MkList(1).Len())", "has no field or method 'Len'"],
				["var x L = MkList(1); fmt.Println(x.Len())", "does not implement L"],
			],
		},
		{
			decls: `type Set[T comparable] map[T]struct{}
func (s Set[T]) Has(x T) bool { _, ok := s[x]; return ok }
func MkSet[T comparable](x T) Set[T] { return Set[T]{x: {}} }
type H interface{ Has(x int) bool }`,
			bodies: [
				["fmt.Println(Set[int]{1: {}}.Has(1))", "has no field or method 'Has'"],
				["fmt.Println(MkSet(1).Has(1))", "has no field or method 'Has'"],
				["var x H = MkSet(1); fmt.Println(x.Has(1))", "does not implement H"],
			],
		},
		{
			decls: `type Fn[T any] func(T) T
func (f Fn[T]) Apply(x T) T { return f(x) }
func MkFn[T any](f func(T) T) Fn[T] { return Fn[T](f) }
type A interface{ Apply(x int) int }`,
			bodies: [
				[
					"fmt.Println(MkFn(func(x int) int { return x }).Apply(1))",
					"has no field or method 'Apply'",
				],
				[
					"var x A = MkFn(func(x int) int { return x }); fmt.Println(x.Apply(1))",
					"does not implement A",
				],
			],
		},
	];
	for (const { decls, bodies } of cases) {
		for (const [body, msg] of bodies) {
			const { errors } = compile(
				`package main\nimport "fmt"\n${decls}\nfunc main() { ${body} }`,
			);
			assertErrorContains(errors, msg);
		}
	}
});

test("== on a type parameter compares struct and array arguments by value", () => {
	const res = compileHybrid(`package main

type P struct{ A int }

func eq[T comparable](a, b T) bool { return a == b }
func ne[T comparable](a, b T) bool { return a != b }

func Main() int {
	r := 0
	if eq(P{1}, P{1}) { r += 1 }
	if ne(P{1}, P{2}) { r += 2 }
	if eq([2]int{1, 2}, [2]int{1, 2}) { r += 4 }
	if eq(1, 1) { r += 8 }
	p := &P{1}
	if !eq(p, &P{1}) { r += 16 }
	return r
}
`).run("Main");
	assertEqual(res.jsRes, 31);
	assertEqual(Number(res.wasmRes), 31);
});

test("a generic struct holding a struct value copies it on assignment", () => {
	const res = compileHybrid(`package main

type P struct{ A int }
type W[T any] struct{ v T }

func Main() int {
	a := W[P]{P{1}}
	b := a
	b.v.A = 9
	return a.v.A*10 + b.v.A
}
`).run("Main");
	assertEqual(res.jsRes, 19);
	assertEqual(Number(res.wasmRes), 19);
});

test("a T value passed on inside generic code is copied for struct arguments", () => {
	const res = compileHybrid(`package main

type P struct{ A int }

func id[T any](x T) T { return x }
func keep[T any](x T) T { y := id(x); return y }

func Main() int {
	p := P{1}
	q := keep(p)
	q.A = 5
	return p.A*10 + q.A
}
`).run("Main");
	assertEqual(res.jsRes, 15);
	assertEqual(Number(res.wasmRes), 15);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
