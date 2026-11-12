// GoFront test suite — generics (type parameters, inference, constraints)

import { fileURLToPath } from "node:url";
import {
	assert,
	assertAllTargetsOutput,
	assertEqual,
	assertErrorContains,
	assertJsProgramOutput,
	assertJsTargetsOutput,
	assertProgramOutput,
	assertThrows,
	compile,
	compileDir,
	compileHybrid,
	compileWasm,
	Lexer,
	runJs,
	section,
	summarize,
	test,
	withTempDir,
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

section(
	"Generic named types — embedding, defined types, type switches (Task 0.32)",
);

function genericsParity(name, src, expected) {
	test(name, () => {
		const res = compileHybrid(src).run("Main");
		assertEqual(res.jsRes, expected);
		assertEqual(Number(res.wasmRes), expected);
	});
}

genericsParity(
	"a generic struct sees methods and fields promoted from an embedded struct (P44)",
	`package main

type Base struct{ n int }

func (b Base) N() int { return b.n }

type Outer[T any] struct {
	Base
	v T
}

func Main() int {
	o := Outer[string]{Base: Base{n: 7}, v: "x"}
	p := &Outer[int]{Base: Base{n: 3}}
	return o.N() + o.n + p.N()*100
}
`,
	314,
);

genericsParity(
	"a pointer-receiver method promoted into a generic struct writes the embedded value",
	`package main

type Base struct{ n int }

func (b *Base) Inc() { b.n++ }

type Outer[T any] struct {
	Base
	v T
}

func Main() int {
	o := Outer[string]{Base: Base{n: 7}}
	o.Inc()
	return o.n
}
`,
	8,
);

genericsParity(
	"type S3[T any] Base gets Base's fields and its own methods (P45)",
	`package main

type Base struct{ n int }

type S3[T any] Base

func (s S3[T]) N() int { return s.n }

func Main() int {
	return S3[int]{n: 5}.N() + S3[string]{n: 1}.N()*10
}
`,
	15,
);

genericsParity(
	"a type switch tells instantiations of one generic type apart (P42)",
	`package main

type Stack[T any] struct{ items []T }
type Pt struct{ X int }

func Main() int {
	var x any = &Stack[string]{}
	var y any = Stack[int]{}
	var z any = &Stack[Pt]{}
	r := 0
	switch x.(type) {
	case *Stack[int]:
		r = 1
	case *Stack[string]:
		r = 2
	}
	switch y.(type) {
	case Stack[string]:
		r += 10
	case Stack[int]:
		r += 20
	}
	if _, ok := x.(*Stack[int]); ok {
		r += 100
	}
	if _, ok := z.(*Stack[Pt]); ok {
		r += 1000
	}
	if _, ok := z.(*Stack[string]); ok {
		r += 10000
	}
	return r
}
`,
	1022,
);

section("Generics — embedded instances and array type arguments");

test("an embedded generic instance promotes its fields on every target", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type Inner[T any] struct{ v T }

type W[T any] struct {
	Inner[T]
	w int
}

func main() {
	x := W[int]{Inner: Inner[int]{v: 4}, w: 1}
	fmt.Println(x.v, x.w)
}
`,
		"4 1\n",
	);
});

test("an array field named like a generic still parses as a field", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type A struct {
	a [2]int
	b int
}

func main() {
	x := A{a: [2]int{1, 2}, b: 3}
	fmt.Println(x.a[1], x.b)
}
`,
		"2 3\n",
	);
});

test("a type assertion accepts an array type argument", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type Stack[T any] struct{ items []T }

func main() {
	var s Stack[[2]int]
	var x any = s
	_, ok := x.(Stack[[2]int])
	fmt.Println(ok)
	_, ok = x.(Stack[int])
	fmt.Println(ok)
}
`,
		"true\nfalse\n",
	);
});

section(
	"Generics — receiver type parameters, function values, explicit arguments",
);

test("a generic receiver value copies into a local of its own type", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type Stack[T any] struct{ items []T }

func (s Stack[T]) Copy() Stack[T] {
	c := s
	return c
}

type List[T any] struct {
	Val  T
	Next *List[T]
}

func (l *List[T]) Last() T {
	p := l
	for p.Next != nil {
		p = p.Next
	}
	return p.Val
}

func main() {
	s := Stack[int]{}
	fmt.Println(len(s.Copy().items))
	l := &List[int]{Val: 1, Next: &List[int]{Val: 2}}
	fmt.Println(l.Last())
}
`,
		"0\n2\n",
	);
});

test("an instantiated generic function is a value", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func Id[T any](x T) T { return x }

func main() {
	f := Id[int]
	fmt.Println(f(3))
}
`,
		"3\n",
	);
});

test("explicit type arguments are checked", () => {
	assertErrorContains(
		compile(`package main
func Sum[T int | float64](a, b T) T { return a + b }
func f() int {
	return 3 + Sum[float64](1, 2)
}
func main() { f() }`).errors,
		"mismatched types",
	);
	assertErrorContains(
		compile(`package main
func Id[T any](x T) T { return x }
func main() { Id[int, int](1) }`).errors,
		"got 2 type arguments",
	);
	assertErrorContains(
		compile(`package main
import "strings"
func main() { strings.ToUpper[int]("a") }`).errors,
		"not a generic function",
	);
	assertErrorContains(
		compile(`package main
func C[T any](n int) T { return T(n) }
func main() { C[int](1) }`).errors,
		"cannot convert",
	);
});

test("valid explicit instantiations still compile", () => {
	const { errors } = compile(`package main
func Sum[T int | float64](a, b T) T { return a + b }
func Conv[T int | float64](n int) T { return T(n) }
func main() {
	_ = 3 + Sum[int](1, 2)
	_ = Conv[float64](1)
}`);
	assertEqual(errors.length, 0);
});

test("untyped constants infer T from the widest constant kind", async () => {
	await assertProgramOutput(
		`package main

import (
	"fmt"
	"math"
)

func Max[T ~int | ~float64](a, b T) T {
	if a > b {
		return a
	}
	return b
}
func Sum[T ~int | ~float64](a, b T) T { return a + b }
func takes(f float64) float64         { return f }

func main() {
	fmt.Println(math.Sqrt(Max(4, 9.0)))
	fmt.Println(takes(Sum(1, 2.5)))
	var f float64 = Max(1, 2.5)
	fmt.Println(f)
	var h float64 = Sum(1, 2.5) + 1
	fmt.Println(h)
}
`,
		"3\n3.5\n2.5\n4.5\n",
	);
});

test("a self-referential instantiation reports a cycle", () => {
	assertErrorContains(
		compile(`package main
type T[X any] struct{ n *T[[]X] }
func main() {
	var t T[int]
	_ = t
}`).errors,
		"instantiation cycle",
	);
});

test("growing instantiation cycles report an error quickly", () => {
	for (const src of [
		`package main
type Pair[A, B any] struct{ a A; b B }
type Chain[T any] struct{ next *Chain[Pair[T, T]] }
func main() {
	var c Chain[int]
	_ = c
}`,
		`package main
type Chain[T any] struct{ next *Chain[[]T]; m map[string]*Chain[*T] }
func main() {
	var c Chain[int]
	_ = c
}`,
	]) {
		const start = Date.now();
		assertErrorContains(compile(src).errors, "instantiation cycle");
		assert(Date.now() - start < 5000, "cycle detection took too long");
	}
});

test("non-cyclic recursive generic types still compile", () => {
	const { errors } = compile(`package main
type List[T any] struct{ next *List[T]; v T }
type Tree[T any] struct{ kids []Tree[T] }
func main() {
	var a List[List[int]]
	var b Tree[Tree[string]]
	_, _ = a, b
}`);
	assertEqual(errors.length, 0);
});

const TWO_PACKAGES = {
	"a/a.go": `package a

type Pt struct{ X int }
`,
	"b/b.go": `package b

type Pt struct{ Y string }
`,
};

const twoPackageMain = (body) => `package main

import (
	"fmt"

	"./a"
	"./b"
)

type Box[T any] struct{ v T }

func main() {
${body}
}
`;

test("package-qualified type arguments keep their own fields", () => {
	withTempDir(
		{
			...TWO_PACKAGES,
			"main.go": twoPackageMain(`	x := Box[a.Pt]{a.Pt{X: 1}}
	y := Box[b.Pt]{b.Pt{Y: "s"}}
	fmt.Println(x.v.X, y.v.Y)`),
		},
		(dir) => {
			// Type-checks: `y.v.Y` resolves against b.Pt, `x.v.X` against a.Pt.
			const { errors } = compileDir(dir);
			assertEqual(errors?.length ?? 0, 0);
		},
	);
});

section("Generics — dynamic types, conversions and identity");

test("type assertions and switches to a type parameter use the instantiated type", async () => {
	await assertProgramOutput(
		`package main

import (
	"errors"
	"fmt"
)

type MyErr struct{}

func (*MyErr) Error() string { return "my" }

type Other struct{}

func (*Other) Error() string { return "o" }

type Code int

func (c Code) Error() string { return fmt.Sprint("code ", int(c)) }

type Name string

type Stack[T any] struct{ items []T }

func As[T any](err error) bool {
	for err != nil {
		if _, ok := err.(T); ok {
			return true
		}
		err = errors.Unwrap(err)
	}
	return false
}

func Is2[T any](v any) bool {
	_, ok := v.(T)
	return ok
}

func Cast[T any](v any) T { return v.(T) }

func Kind[T any](v any) string {
	switch v.(type) {
	case T:
		return "T"
	case string:
		return "str"
	}
	return "none"
}

func Bind[T any](v any) string {
	switch x := v.(type) {
	case T:
		_ = x
		return "T"
	}
	return "no"
}

func main() {
	wrapped := fmt.Errorf("%w", &MyErr{})
	fmt.Println(As[*Other](wrapped), As[*MyErr](&MyErr{}), As[*MyErr](wrapped))
	fmt.Println(Is2[int](1), Is2[string](1), Is2[string]("a"), Is2[bool](true), Is2[bool]("a"))
	fmt.Println(Is2[*MyErr](&MyErr{}), Is2[*Other](&MyErr{}), Is2[error](&MyErr{}), Is2[error](1))
	fmt.Println(Is2[Code](Code(1)), Is2[int](Code(1)), Is2[Name](Name("n")), Is2[string](Name("n")))
	fmt.Println(Is2[Stack[int]](Stack[int]{}), Is2[Stack[int]](Stack[string]{}), Is2[*Stack[int]](&Stack[int]{}), Is2[*Stack[int]](&Stack[string]{}))
	fmt.Println(Cast[int](3), Cast[string]("q"), Cast[Code](Code(7)), Cast[Name](Name("nm")) + "!")
	fmt.Println(Kind[int](1), Kind[string]("a"), Kind[bool](1), Kind[*MyErr](&MyErr{}))
	fmt.Println(Bind[Code](Code(4)), Bind[int](5), Bind[bool](5), Bind[*MyErr](&MyErr{}))
}
`,
		"false true true\ntrue false true true false\ntrue false true false\ntrue false true false\ntrue false true false\n3 q code 7 nm!\nT T none T\nT T no T\n",
	);
});

test("conversions to a type parameter truncate and wrap like the instantiated type", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type Num interface {
	~int | ~int8 | ~uint8 | ~int16 | ~uint16 | ~int32 | ~uint32 | ~float32 | ~float64
}

type Small int8

type Box[T Num] struct{ v T }


func Half[T Num](x int) T      { return T(x / 2) }
func conv[T Num](x int) T      { return T(x) }
func Wrap[T Num](x int) T      { return T(x + 1) }
func FromF[T Num](f float64) T { return T(f) }
func Twice[T Num](x int) T     { return conv[T](x) }

func main() {
	fmt.Println(Half[int](9), conv[int8](200), Wrap[uint8](255))
	fmt.Println(conv[uint8](-1), conv[int16](40000), conv[uint16](-1), conv[int32](1<<31), conv[int](7))
	fmt.Println(FromF[int](3.9), FromF[int](-3.9), FromF[float32](0.1) == float32(0.1), FromF[float64](2.5))
	fmt.Println(Twice[int8](300), Twice[uint8](300))
	var b Box[int8]
	b.v = conv[int8](200)
	fmt.Println(b.v)
}
`,
		"4 -56 0\n255 -25536 65535 -2147483648 7\n3 -3 true 2.5\n44 44\n-56\n",
	);
});

test("erased generics keep instance identity, compare any by value and zero T", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type Stack[T any] struct{ items []T }

type Pair[A, B any] struct {
	a A
	b B
}

type P struct{ X int }

type Arr [2]int

func mk[T any]() any            { return &Stack[T]{} }
func mkv[T any]() any           { return Stack[T]{} }
func mkp[A, B any]() any        { return &Pair[A, B]{} }
func eq[T comparable](a, b T) bool { return a == b }
func ne[T comparable](a, b T) bool { return a != b }

func mut[T any](xs ...T) {
	var z T
	xs[0] = z
}

func zeros[T any](n int) []T {
	out := make([]T, n)
	var z T
	for i := range out {
		out[i] = z
	}
	return out
}

func main() {
	_, ok := mk[int]().(*Stack[string])
	_, ok2 := mk[int]().(*Stack[int])
	_, ok3 := mkv[string]().(Stack[string])
	_, ok4 := mkv[string]().(Stack[int])
	fmt.Println(ok, ok2, ok3, ok4)
	_, ok5 := mkp[int, string]().(*Pair[int, string])
	_, ok6 := mkp[int, string]().(*Pair[string, int])
	fmt.Println(ok5, ok6)
	fmt.Println(eq[any](P{1}, P{1}), eq[any](P{1}, P{2}), eq[P](P{1}, P{1}), eq[int](1, 1), eq[string]("a", "b"), ne[any](P{1}, P{1}))
	fmt.Println(eq[any](1, "a"), eq[any](nil, nil), eq[*P](&P{1}, &P{1}), eq[any](P{1}, 1))
	p := &P{1}
	fmt.Println(eq[*P](p, p), eq[any](p, p), eq[any](p, &P{1}), eq[Arr](Arr{1, 2}, Arr{1, 2}), eq[Arr](Arr{1, 2}, Arr{2, 1}))
	c := []int{4, 5}
	mut(c...)
	fmt.Println(c)
	d := []string{"a", "b"}
	mut(d...)
	fmt.Println(d, len(d[0]))
	e := []P{{1}, {2}}
	mut(e...)
	fmt.Println(e)
	mut(1, 2)
	fmt.Println(zeros[int](2), zeros[string](2), zeros[P](1), zeros[bool](1))
}
`,
		"false true true false\ntrue false\ntrue false true true false false\nfalse true false false\ntrue true false true false\n[0 5]\n[ b] 0\n[{0} {2}]\n[0 0] [ ] [{0}] [false]\n",
	);
});

test("mutually recursive generic functions keep their type information", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func B[T any](x any, n int) bool {
	if n == 0 {
		return false
	}
	return A[T](x, n-1)
}

func A[T any](x any, n int) bool {
	if n > 0 {
		return B[T](x, n)
	}
	_, ok := x.(T)
	return ok
}

func main() {
	fmt.Println(B[string](1, 1))
	fmt.Println(A[int](1, 0), A[string](1, 2), B[int](1, 2))
}
`,
		"false\ntrue false true\n",
	);
});

test("Clone over []P copies range values when appending", async () => {
	const src = `package main

import "fmt"

type P struct{ V int }

func Clone[T any](s []T) []T {
	var out []T
	for _, v := range s {
		out = append(out, v)
	}
	return out
}

func main() {
	a := []P{{1}}
	b := Clone(a)
	b[0].V = 9
	fmt.Println(a, b)
}
`;
	await assertProgramOutput(src, "[{1}] [{9}]\n");
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "[{1}] [{9}]");
});

test("List[T].Map with callback mutating Pair leaves source intact", async () => {
	const src = `package main

import "fmt"

type Pair struct {
	Key string
	Val int
}

type List[T any] struct {
	items []T
}

func (l List[T]) Map(f func(T) T) (out List[T]) {
	for _, item := range l.items {
		out.items = append(out.items, f(item))
	}
	return out
}

func main() {
	l := List[Pair]{items: []Pair{{"a", 1}, {"b", 2}}}
	_ = l.Map(func(p Pair) Pair {
		p.Val *= 10
		return p
	})
	fmt.Println(l.items)
}
`;
	await assertProgramOutput(src, "[{a 1} {b 2}]\n");
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "[{a 1} {b 2}]");
});

test("generic Sum over int64 and int slices (Task 1.3)", async () => {
	const src = `package main

import "fmt"

func Sum[T ~int | ~int64](xs []T) T {
	var s T
	for _, x := range xs {
		s += x + 1
	}
	return s
}

func main() {
	fmt.Println(Sum([]int64{1 << 60, 1}))
	fmt.Println(Sum([]int{1, 2}))
}
`;
	await assertProgramOutput(src, "1152921504606846979\n5\n");
});

section("Generics — core types of constrained type parameters");

const CORE_PRELUDE = `package main
import "fmt"
type IDs []int
func (s IDs) Sum() int { t := 0; for _, v := range s { t += v }; return t }
type Set map[string]bool
`;

test("core type: index, slice, len, cap, range on [S ~[]E, E any]", async () => {
	const src = `${CORE_PRELUDE}
func First[S ~[]E, E any](s S) E { return s[0] }
func Tail[S ~[]E, E any](s S) S { return s[1:] }
func Count[S ~[]E, E any](s S) int {
	n := 0
	for range s { n++ }
	for i := range s { n += i }
	return n + len(s) + cap(s)
}
func Put[S ~[]E, E any](s S, v E) { s[0] = v }
func main() {
	xs := []int{7, 8, 9}
	fmt.Println(First[[]int, int](xs), len(Tail[[]int, int](xs)), Count[[]int, int](xs))
	Put[[]int, int](xs, 5)
	fmt.Println(xs[0], First[IDs, int](IDs{4}))
}
`;
	await assertProgramOutput(src, "7 2 12\n5 4\n");
});

test("core type: make, append, copy, composite literal on a slice core", async () => {
	const src = `${CORE_PRELUDE}
func Mk[S ~[]E, E any](n int) S { return make(S, n) }
func Dbl[S ~[]E, E any](s S) S { return append(s, s...) }
func Cp[S ~[]E, E any](d, s S) int { return copy(d, s) }
func Lit[S ~[]E, E any](a, b E) S { return S{a, b} }
func main() {
	fmt.Println(len(Mk[IDs, int](3)))
	fmt.Println(Dbl[IDs, int](IDs{1, 2}).Sum())
	d := make([]int, 2)
	fmt.Println(Cp[[]int, int](d, []int{5, 6, 7}), d)
	fmt.Println(Lit[IDs, int](3, 4).Sum())
}
`;
	await assertProgramOutput(src, "3\n6\n2 [5 6]\n7\n");
});

test("core type: map index, range, len, make on [M ~map[K]V, K comparable, V any]", async () => {
	const src = `${CORE_PRELUDE}
func Get[M ~map[K]V, K comparable, V any](m M, k K) V { return m[k] }
func Len[M ~map[K]V, K comparable, V any](m M) int { return len(m) }
func Mk[M ~map[K]V, K comparable, V any]() M { return make(M) }
func Keys[M ~map[K]V, K comparable, V any](m M) int {
	n := 0
	for range m { n++ }
	return n
}
func main() {
	s := Set{"a": true}
	fmt.Println(Get[Set, string, bool](s, "a"), Len[Set, string, bool](s), Keys[Set, string, bool](s))
	m := Mk[Set, string, bool]()
	m["x"] = true
	fmt.Println(len(m))
}
`;
	await assertProgramOutput(src, "true 1 1\n1\n");
});

test("core type: several underlying types keep Cannot index type", () => {
	const { errors } = compile(`package main
func F[T int | string](x T) { _ = x[0] }
func main() { F[string]("a") }`);
	assertErrorContains(errors, "Cannot index type T");
});

test("core type: several underlying types cannot be sliced", () => {
	const { errors } = compile(`package main
func F[T ~[]int | ~[]string](x T) { _ = x[1:] }
func main() {}`);
	assertErrorContains(errors, "Cannot slice type T");
});

test("inference through core types derives E, K and V", async () => {
	const src = `${CORE_PRELUDE}
func First[S ~[]E, E any](s S) E { return s[0] }
func Z[S ~[]E, E any](s S) S { return S(nil) }
func Len[M ~map[K]V, K comparable, V any](m M) int { return len(m) }
func Id[S ~[]E, E any](s S) S { return s }
func main() {
	fmt.Println(First([]int{7, 8}))
	fmt.Println(Z([]int{1}) == nil)
	fmt.Println(Len(map[string]int{"a": 1}), Len(Set{"k": true}))
	fmt.Println(Id(IDs{1, 2}).Sum())
}
`;
	await assertProgramOutput(src, "7\ntrue\n1 1\n3\n");
});

test("core type: var zero S, S(nil) and append(S(nil), s...)", async () => {
	const src = `${CORE_PRELUDE}
func Zero[S ~[]E, E any]() S { var z S; return z }
func Nil[S ~[]E, E any]() S { return S(nil) }
func Cl[S ~[]E, E any](s S) S { return append(S(nil), s...) }
func main() {
	fmt.Println(Zero[IDs, int]() == nil, Nil[IDs, int]() == nil, len(Zero[[]int, int]()))
	c := Cl(IDs{1, 2})
	c[0] = 9
	fmt.Println(c.Sum())
}
`;
	await assertProgramOutput(src, "true true 0\n11\n");
});

test("named slice and map type arguments produce valid WASM", async () => {
	const src = `${CORE_PRELUDE}
func Id[S ~[]E, E any](s S) S { return append(s, s...) }
func Keep[M ~map[K]V, K comparable, V any](m M) M { m2 := make(M); for k, v := range m { m2[k] = v }; return m2 }
func main() {
	fmt.Println(Id[IDs, int](IDs{1, 2}).Sum())
	k := Keep[Set, string, bool](Set{"a": true})
	fmt.Println(len(k), k["a"])
}
`;
	await assertProgramOutput(src, "6\n1 true\n");
});

test("type-literal type arguments instantiate a function value", async () => {
	const src = `package main
import "fmt"
func Index[S ~[]E, E comparable](s S, v E) int {
	for i, x := range s {
		if x == v { return i }
	}
	return -1
}
func Keys[M ~map[K]V, K comparable, V any](m M) int { return len(m) }
func main() {
	f := Index[[]int, int]
	g := Keys[map[string]int, string, int]
	fmt.Println(f([]int{4, 5}, 5), g(map[string]int{"a": 1}))
}
`;
	await assertProgramOutput(src, "1 1\n");
});

test("slices.Index[[]int, int] is a function value in JS", async () => {
	await assertJsProgramOutput(
		`package main
import (
	"fmt"
	"slices"
)
func main() {
	f := slices.Index[[]int, int]
	fmt.Println(f([]int{1}, 1))
}
`,
		"0\n",
	);
});

test("a[foo, bar] on a non-generic value is an error, not an instantiation", () => {
	assertThrows(
		() => compile("package main\nfunc main() { var a int; _ = a[foo, bar] }"),
		"expected ']'",
	);
	assertThrows(
		() =>
			compile(
				"package main\nfunc Main() int { var a int = 42; return a[foo, bar] }",
			),
		"expected ']'",
	);
});

section(
	"Generics — instantiation cycles, T(n) conversions, embedded promotion",
);

const cycleDecl = `package main
type Stack[T any] struct{ items []T }
func (s Stack[T]) Wrap() Stack[[]T] { return Stack[[]T]{} }
func main() {}
`;
const cycleBody = `package main
type Stack[T any] struct{ items []T }
func (s Stack[T]) Wrap() int {
	x := Stack[[]T]{}
	return len(x.items)
}
func main() {}
`;

for (const [name, src] of [
	["declaration", cycleDecl],
	["body", cycleBody],
]) {
	test(`an instantiation cycle in a method ${name} is diagnosed on js`, () => {
		const { errors } = compile(src);
		assertErrorContains(errors, "instantiation cycle");
	});
	test(`an instantiation cycle in a method ${name} is diagnosed on wasm`, () => {
		const { errors } = compile(src, { target: "wasm" });
		assertErrorContains(errors, "instantiation cycle");
	});
}

test("T(n) inside a method of a generic type converts with a numeric constraint", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Num interface{ ~int | ~float64 }

type Box[T Num] struct{ v T }

func (b Box[T]) Scaled(n int) T { return T(n) * 2 }

func main() {
	fmt.Println(Box[float64]{}.Scaled(3))
}
`,
		"6\n",
	);
});

test("T(n) in an unconstrained generic function still errors", () => {
	const { errors } = compile(`package main
func a[T any](n int) T { return T(n) }
func main() { _ = a[int](1) }`);
	assertErrorContains(errors, "cannot convert");
});

test("methods promote through an embedded generic instance", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Inner[T any] struct{ v T }

func (i Inner[T]) Get() T { return i.v }

type W struct{ Inner[int] }

func main() {
	fmt.Println(W{}.Get())
}
`,
		"0\n",
	);
});

test("fields promote through an embedded pointer to a generic instance", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Inner[T any] struct{ v T }

type P[T any] struct{ *Inner[T] }

func main() {
	p := P[string]{&Inner[string]{"x"}}
	fmt.Println(p.v)
}
`,
		"x\n",
	);
});

test("methods promote through two levels of embedding", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Base struct{ n int }

func (b Base) Hello() int { return b.n + 1 }

type E struct{ Base }

type Deep struct{ E }

func main() {
	fmt.Println(Deep{}.Hello())
}
`,
		"1\n",
	);
});

test("generic integer arithmetic truncates and wraps for the instantiated type", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Int interface {
	~int | ~int8 | ~uint8 | ~int32 | ~uint32
}

func Half[T Int](x T) T { return x / 2 }

func Wrap[T Int](x T) T { return x + 1 }

func Gen[T Int](x T) T { return x - 1 }

func Shl[T Int](x T) T { return x << 7 }

func main() {
	fmt.Println(Half[int](9), Wrap[uint8](255))
	fmt.Println(Gen(uint8(0)), Gen(int8(-128)), Gen(uint32(0)))
	fmt.Println(Half(int8(-7)), Wrap(int32(2147483647)), Shl(uint8(3)))
}
`,
		"4 0\n255 127 4294967295\n-3 -2147483648 128\n",
	);
});

test("generic compound assignment, increments and 64-bit arithmetic wrap", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Int interface {
	~int8 | ~uint8 | ~int64 | ~uint64 | ~int
}

func Acc[T Int](x T) T {
	x += 100
	x *= 2
	x++
	x >>= 1
	return x
}

func Neg[T Int](x T) T { return x - 1 }

func main() {
	fmt.Println(Acc(int8(60)), Acc(uint8(200)), Acc(int(5)))
	fmt.Println(Neg(uint64(0)), Neg(int64(-9223372036854775808)))
}
`,
		"32 44 105\n18446744073709551615 9223372036854775807\n",
	);
});

test("generic float arithmetic is unchanged", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Num interface{ ~int | ~float64 }

func Half[T Num](x T) T { return x / 2 }

func main() {
	fmt.Println(Half(9.0), Half(9))
}
`,
		"4.5 4\n",
	);
});

test("a constraint method is callable on named non-struct type arguments", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type Color int

func (c Color) String() string { return "col" }

type Cs []int

func (c Cs) String() string { return "cs" }

func S[T fmt.Stringer](x T) string { return x.String() }

func main() {
	fmt.Println(S(Color(2)), S(Cs{1}))
}`,
		"col cs\n",
	);
});

section("Generics — constraints referencing later type parameters");

test("a constraint may reference a type parameter declared later", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type SliceIface[E any] interface{ ~[]E }

func F[S SliceIface[E], E any](s S) E { return s[0] }

func main() {
	fmt.Println(F([]int{7}))
}
`,
		"7\n",
	);
});

section("Generics — constraint interfaces outside constraints");

function constraintErrorsOn(target, src) {
	if (target === "wasm") return compileWasm(src).errors ?? [];
	return compile(src, { target }).errors ?? [];
}

const CONSTRAINT_PRELUDE = "package main\ntype N interface{ ~int | ~string }\n";
const CONSTRAINT_USES = [
	[
		"a var of constraint type",
		`${CONSTRAINT_PRELUDE}func main() {\n\tvar x N\n\t_ = x\n}`,
		"cannot use type N outside a type constraint",
	],
	[
		"a package-level var of constraint type",
		`${CONSTRAINT_PRELUDE}var x N\nfunc main() { _ = x }`,
		"cannot use type N outside a type constraint",
	],
	[
		"a struct field of constraint type",
		`${CONSTRAINT_PRELUDE}type S struct{ F N }\nfunc main() { _ = S{} }`,
		"cannot use type N outside a type constraint",
	],
	[
		"a struct field naming a constraint declared later",
		"package main\ntype S struct{ F N }\ntype N interface{ ~int | ~string }\nfunc main() { _ = S{} }",
		"cannot use type N outside a type constraint",
	],
	[
		"a param of constraint type",
		`${CONSTRAINT_PRELUDE}func f(n N) {}\nfunc main() {}`,
		"cannot use type N outside a type constraint",
	],
	[
		"a result of constraint type",
		`${CONSTRAINT_PRELUDE}func f() N { panic(0) }\nfunc main() {}`,
		"cannot use type N outside a type constraint",
	],
	[
		"a constraint embedding a type set",
		"package main\ntype N interface{ ~int | ~string }\ntype E interface{ N }\nfunc main() {\n\tvar x E\n\t_ = x\n}",
		"cannot use type E outside a type constraint",
	],
	[
		"a var of type comparable",
		"package main\nfunc main() {\n\tvar c comparable\n\t_ = c\n}",
		"cannot use type comparable outside a type constraint",
	],
];

for (const [name, src, want] of CONSTRAINT_USES) {
	for (const target of ["js", "both", "wasm"]) {
		test(`${name} is rejected (${target})`, () => {
			assertErrorContains(constraintErrorsOn(target, src), want);
		});
	}
}

test("constraint interfaces stay valid in constraint positions", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type N interface{ ~int | ~string }

type NM interface{ N }

type D N

func g[T N](x T) T { return x }

func h[T NM](x T) T { return x }

func k[T D](x T) T { return x }

func eq[T comparable](a, b T) bool { return a == b }

func main() {
	fmt.Println(g(3), h("s"), k(4), eq(1, 1))
}
`,
		"3 s 4 true\n",
	);
});

section("comparable embedded in a constraint interface");

test("interface{ ~int; comparable } constrains a type parameter", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type NM interface {
	~int
	comparable
}

func h[T NM](x T) T { return x }

func main() {
	fmt.Println(h(3))
}
`,
		"3\n",
	);
});

test("interface{ comparable; ~int | ~string } constrains a type parameter", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type CS interface {
	comparable
	~int | ~string
}

func same[T CS](a, b T) bool { return a == b }

func main() {
	fmt.Println(same(1, 1), same("a", "b"))
}
`,
		"true false\n",
	);
});

test("interface{ comparable; M() } allows == in the body", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type CM interface {
	comparable
	M()
}

type T struct{ n int }

func (T) M() {}

func eq[V CM](a, b V) bool { return a == b }

func main() {
	fmt.Println(eq(T{1}, T{1}))
}
`,
		"true\n",
	);
});

for (const [name, src, want] of [
	[
		"[]int against interface{ comparable; ~[]int }",
		"package main\ntype CS interface {\n\tcomparable\n\t~[]int\n}\nfunc h[T CS](x T) T { return x }\nfunc main() { _ = h([]int{}) }",
		"does not satisfy",
	],
	[
		"a var of type interface{ comparable }",
		"package main\nfunc main() {\n\tvar x interface{ comparable }\n\t_ = x\n}",
		"outside a type constraint",
	],
	[
		"a var of a named interface embedding comparable",
		"package main\ntype C interface {\n\tcomparable\n\tM()\n}\nfunc main() {\n\tvar x C\n\t_ = x\n}",
		"outside a type constraint",
	],
]) {
	for (const target of ["js", "both", "wasm"]) {
		test(`${name} is rejected (${target})`, () => {
			assertErrorContains(constraintErrorsOn(target, src), want);
		});
	}
}

section("Explicit func type arguments");

test("an explicit func type argument instantiates a generic function", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func mk[V any]() any { return map[string]V{} }

func zero[V any]() V {
	var z V
	return z
}

func main() {
	w := mk[func(int)]()
	_, ok := w.(map[string]int)
	fmt.Println(ok, zero[func(int)]() == nil)
}
`,
		"false true\n",
	);
});

test("an explicit func type argument keeps its type name", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func mk[V any]() any { return map[string]V{} }

func main() {
	w := mk[func(int)]()
	fmt.Printf("%T\\n", w)
}
`,
		"map[string]func(int)\n",
	);
});

test("func type arguments with results and several parameters instantiate", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func mk[V any]() any                  { return map[string]V{} }
func pair[K comparable, V any]() any { return map[K]V{} }

func main() {
	fmt.Printf("%T\\n", mk[func(int) string]())
	fmt.Printf("%T\\n", pair[string, func(int) bool]())
	fmt.Printf("%T\\n", pair[int, func()]())
}
`,
		"map[string]func(int) string\nmap[string]func(int) bool\nmap[int]func()\n",
	);
});

test("func type arguments with several parameters compile on every target", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func pair[K comparable, V any]() int {
	var m map[K]V
	var s []V
	return len(m) + len(s)
}

func main() {
	fmt.Println(pair[string, func(int) bool](), pair[int, func()]())
}
`,
		"0 0\n",
	);
});

test("an index by a called func literal still indexes", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func one() int { return 1 }

func main() {
	a := []int{10, 20, 30}
	m := map[int]string{1: "one"}
	fmt.Println(a[one()], m[func() int { return 1 }()], a[func() int { return 2 }()])
}
`,
		"20 one 30\n",
	);
});

section("Generics — type arguments inferred from array parameters");

test("arr[V](a [2]V) infers V from [2]int and [2]string", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func arr[V any](a [2]V) any { return a }

func main() {
	fmt.Printf("%T %v\\n", arr([2]int{1, 2}), arr([2]int{1, 2}))
	fmt.Printf("%T %v\\n", arr([2]string{"a", "b"}), arr([2]string{"a", "b"}))
}
`,
		"[2]int [1 2]\n[2]string [a b]\n",
	);
});

test("V is inferred through nested, pointer and slice-of-array forms", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func nest[V any](a [2][2]V) any { return a }
func ptr[V any](a *[2]V) any { return a }
func sl[V any](a [2][]V) any { return a }
func first[V any](a [2]V) V { return a[0] }

func main() {
	x := [2]int{5, 6}
	fmt.Printf("%T\\n", nest([2][2]int{}))
	fmt.Printf("%T\\n", ptr(&x))
	fmt.Printf("%T\\n", sl([2][]int{}))
	fmt.Println(first([2]string{"a", "b"}), first(x))
}
`,
		"[2][2]int\n*[2]int\n[2][]int\na 5\n",
	);
});

for (const target of ["js", "both", "wasm"]) {
	const gen = `package main

import "fmt"

func arr[V any](a [2]V) any { return a }

func main() {
	fmt.Println(arr(ARG))
}
`;
	const errs = (arg) => {
		const src = gen.replace("ARG", arg);
		return (
			(target === "wasm" ? compileWasm(src) : compile(src, { target }))
				.errors ?? []
		);
	};
	test(`an array of the wrong length is rejected (${target})`, () => {
		assertErrorContains(errs("[3]int{}"), "different array lengths");
	});
	test(`a slice for an array parameter is rejected (${target})`, () => {
		assertErrorContains(errs("[]int{1, 2}"), "Cannot infer type arguments");
	});
}

section(
	"Generics — type-parameter index and size operands need integer type sets",
);

{
	const operandProgram = (
		constraintDecl,
		constraint,
		use,
		call,
	) => `package main

import "fmt"

${constraintDecl}
func f[T ${constraint}](i T) {
	s := []int{1, 2, 3}
	_ = s
	${use}
}

func main() {
	${call}
	fmt.Println("ok")
}
`;
	const NON_INT_USES = [
		"_ = s[i]",
		"_ = s[:i]",
		"_ = make([]int, i)",
		"_ = make(map[string]int, i)",
	];
	for (const [name, decl, constraint, arg] of [
		["any", "", "any", "1"],
		["comparable", "", "comparable", "1"],
		["fmt.Stringer", "", "fmt.Stringer", "nil"],
		["~int | ~string", "", "~int | ~string", "1"],
		["~float64", "", "~float64", "1.5"],
		[
			"a named interface with ~float64",
			"type F interface{ ~float64 }",
			"F",
			"1.5",
		],
	]) {
		for (const use of NON_INT_USES) {
			for (const target of ["js", "wasm"]) {
				for (const called of [true, false]) {
					test(`[T ${name}] ${use} is rejected, ${called ? "called" : "never called"} (${target})`, () => {
						const src = operandProgram(
							decl,
							constraint,
							use,
							called ? `f(${arg})` : "",
						);
						const { errors } =
							target === "wasm" ? compileWasm(src) : compile(src, { target });
						assertErrorContains(errors ?? [], "must be integer");
					});
				}
			}
		}
	}

	test("a non-integer type-parameter index reports once when instantiated on wasm", () => {
		const { errors } = compileWasm(
			operandProgram("", "~float64", "_ = s[i]", "f(1.5)"),
		);
		const n =
			(errors ?? [])
				.map((e) => e.message)
				.join("\n")
				.split("must be integer").length - 1;
		assertEqual(n, 1);
	});

	test("integer type sets index and size (js, both, wasm)", async () => {
		await assertAllTargetsOutput(
			`package main

import "fmt"

type Int interface{ ~int | ~int64 }
type MyInt int

func at[T ~int](s []string, i T) string { return s[i] }
func small[T ~int | ~uint8](s []string, i T) []string { return s[:i] }
func mk[T Int](n T) int { return len(make([]int, n)) + cap(make([]int, 0, n)) }
func keyed[K comparable, V any](m map[K]V, k K) V { return m[k] }
func elem[T any](xs []T, i int) T { return xs[i] }

func main() {
	s := []string{"a", "b", "c"}
	fmt.Println(at(s, MyInt(1)), small(s, uint8(2)), mk(MyInt(3)), mk(2))
	fmt.Println(keyed(map[string]int{"x": 7}, "x"), keyed(map[any]int{1.5: 8}, 1.5))
	fmt.Println(elem([]string{"p", "q"}, 1))
}
`,
			"b [a b] 6 4\n7 8\nq\n",
		);
	});
}

section("Generics — 64-bit type-parameter index and size operands");

test("an int64 or uint64 type-parameter make size, index and bound run (js, both, wasm)", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Int interface{ ~int | ~int64 | ~uint64 }

func mk[T Int](n T) int { return len(make([]int, n)) }
func mkCap[T Int](n T) int { return cap(make([]int, 0, n)) }
func mkMap[T Int](n T) int { return len(make(map[string]int, n)) }
func at[T Int](s []string, n T) string { return s[n] }
func hi[T Int](s []string, n T) []string { return s[:n] }
func lo[T Int](s []string, n T) []string { return s[n:] }
func both[T Int](s []string, n T) []string { return s[n-1 : n+1 : n+1] }
func str[T Int](s string, n T) byte { return s[n] }

func main() {
	s := []string{"a", "b", "c", "d"}
	fmt.Println(mk(int64(3)), mk(uint64(2)), mk(4))
	fmt.Println(mkCap(int64(3)), mkCap(uint64(2)), mkCap(4))
	fmt.Println(mkMap(int64(3)), mkMap(uint64(2)), mkMap(4))
	fmt.Println(at(s, int64(1)), at(s, uint64(2)), at(s, 3))
	fmt.Println(hi(s, int64(1)), hi(s, uint64(2)), hi(s, 3))
	fmt.Println(lo(s, int64(1)), lo(s, uint64(2)), lo(s, 3))
	fmt.Println(both(s, int64(2)), both(s, uint64(3)), both(s, 1))
	fmt.Println(str("xyz", int64(1)), str("xyz", uint64(2)), str("xyz", 0))
}
`,
		"3 2 4\n3 2 4\n0 0 0\nb c d\n[a] [a b] [a b c]\n[b c d] [c d] [d]\n[b c] [c d] [a b]\n121 122 120\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
