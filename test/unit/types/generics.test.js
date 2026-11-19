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
	compile,
	compileDir,
	compileHybrid,
	compileHybridProject,
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

test("approx constraint (~int) accepts a matching type — no error", () => {
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
		"(value of type float64) as int value in return statement",
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
	assertErrorContains(
		compile("package main\nfunc main() { var a int; _ = a[foo, bar] }").errors,
		"expected ']'",
	);
	assertErrorContains(
		compile(
			"package main\nfunc Main() int { var a int = 42; return a[foo, bar] }",
		).errors,
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

section("Generics — union constraints with named-interface terms");

const UNION_DECLS = `type S interface{ ~int }
type U interface{ ~uint }
type I interface{ S | U }
type V interface{ I | ~string }
type MyInt int

func f[T I](x T) T { return x }
func g[T V](x T) T { return x }
func h[T ~int | ~uint](x T) T { return x }
`;

test("a union of named interfaces accepts a type from any term (js, both, wasm)", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

${UNION_DECLS}
func main() {
	fmt.Println(f(1), f(uint(2)), f(MyInt(3)))
	fmt.Println(g(4), g(uint(5)), g("six"), h(7), h(uint(8)))
}
`,
		"1 2 3\n4 5 six 7 8\n",
	);
});

for (const target of ["js", "both", "wasm"]) {
	for (const [name, call] of [
		["a string for a union of named interfaces", 'f("a")'],
		["a float for a union of named interfaces", "f(1.5)"],
		["an int8 for a union of named interfaces", "f(int8(1))"],
		["a float for a nested named union", "g(1.5)"],
		["a string for a ~int | ~uint union", 'h("a")'],
	]) {
		test(`${name} does not satisfy the constraint (${target})`, () => {
			const src = `package main

${UNION_DECLS}
func main() { ${call} }
`;
			const { errors } =
				target === "wasm" ? compileWasm(src) : compile(src, { target });
			assertErrorContains(errors ?? [], "does not satisfy constraint");
		});
	}
}

section("Generic instances over anonymous struct type arguments");

test("distinct anonymous struct arguments give distinct instances", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

type Box[T any] struct{ V T }

func main() {
	a := Box[struct{ X int }]{}
	b := Box[struct{ S string }]{}
	fmt.Println(a.V.X, b.V.S)
}
`,
		"0 \n",
	);
});

test("nested generics keep anonymous struct arguments apart", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

type Box[T any] struct{ V T }
type Outer[T any] struct{ B T }

func main() {
	a := Outer[Box[struct{ X int }]]{}
	b := Outer[Box[struct{ S string }]]{}
	fmt.Println(a.B.V.X, b.B.V.S)
}
`,
		"0 \n",
	);
});

test("the same anonymous struct written twice shares one instance", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

type Box[T any] struct{ V T }

func main() {
	a := Box[struct{ X int }]{}
	a = Box[struct{ X int }]{V: struct{ X int }{3}}
	var b Box[struct{ X int }] = a
	fmt.Println(a.V.X, b.V.X)
}
`,
		"3 3\n",
	);
});

test("anonymous structs differing in field name stay distinct", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

type Box[T any] struct{ V T }

func main() {
	a := Box[struct{ X int }]{}
	b := Box[struct{ Y int }]{}
	fmt.Println(a.V.X, b.V.Y)
}
`,
		"0 0\n",
	);
});

section("Generics — new of a type parameter");

for (const S of ["S", "__S"]) {
	test(`new(T) of a type parameter named ${S} like a package struct`, async () => {
		await assertAllTargetsOutput(
			`package main

import "fmt"

type ${S} struct{ X int }

func f[${S} any](v ${S}) *${S} { return new(${S}) }

func main() {
	fmt.Println(*f[int](3))
	fmt.Println(*f[${S}](${S}{}))
}
`,
			"0\n{0}\n",
		);
	});
}

test("new(T) of a type parameter instantiated with an anonymous struct", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

type S struct{ X int }

func f[S any](v S) *S { return new(S) }

func main() {
	fmt.Println(f[struct{ X int }](struct{ X int }{}).X)
}
`,
		"0\n",
	);
});

section(
	"Generics — instantiated function values infer constraint type parameters",
);

test("R9.3 slices.Sort[[]int] as a value sorts", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"fmt"
	"slices"
)

func main() {
	xs := []int{2, 1}
	f := slices.Sort[[]int]
	f(xs)
	fmt.Println(xs)
}
`,
		"[1 2]\n",
	);
});

test("R9.9 partially instantiated user generic keeps the inferred element type", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func Z[S ~[]E, E any](s S) E {
	var z E
	return z
}

func main() {
	f := Z[[]int]
	fmt.Println(f([]int{3}))
}
`,
		"0\n",
	);
});

test("R9.10 slices.Index[[]int] as a value finds the element", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"fmt"
	"slices"
)

func main() {
	f := slices.Index[[]int]
	fmt.Println(f([]int{4, 5}, 5))
}
`,
		"1\n",
	);
});

test("fully instantiated slices.Sort[[]int, int] and partial First[[]int] still work", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"fmt"
	"slices"
)

func First[S ~[]E, E any](s S) E { return s[0] }

func main() {
	xs := []int{2, 1}
	g := slices.Sort[[]int, int]
	g(xs)
	f := First[[]int]
	fmt.Println(xs, f(xs))
}
`,
		"[1 2] 1\n",
	);
});

section("Generics — review fixes: func values, operators on type parameters");

test("generic func value over an enclosing type parameter infers its element", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"fmt"
	"slices"
)

func Outer[S ~[]E, E int | string](xs S) {
	f := slices.Sort[S]
	f(xs)
}

func Z[S ~[]E, E any](s S) E {
	var z E
	return z
}

func Outer2[S ~[]E, E any](xs S) E {
	f := Z[S]
	return f(xs)
}

func main() {
	xs := []int{2, 1}
	Outer(xs)
	fmt.Println(xs, Outer2([]int{5}))
}
`,
		"[1 2] 0\n",
	);
});

test("inferred type argument that fails its constraint is rejected", () => {
	const { errors } = compile(`package main

import "slices"

func main() {
	_ = slices.Sort[[]func()]
}
`);
	assertErrorContains(errors, "does not satisfy");
});

test("partial instantiation with an uninferable type parameter is rejected as a value", () => {
	const { errors } = compile(`package main

func G[A, B any](a A) B {
	var b B
	return b
}

func main() {
	f := G[int]
	_ = f
}
`);
	assertErrorContains(errors, "cannot infer B");
});

test("string type parameter cannot be incremented", () => {
	const { errors } = compile(`package main

func F[T ~string](a T) T {
	a++
	return a
}
`);
	assertErrorContains(errors, "non-numeric type");
});

test("mixed string/int type parameter cannot be incremented", () => {
	const { errors } = compile(`package main

func F[T ~int | ~string](a T) T {
	a++
	return a
}
`);
	assertErrorContains(errors, "non-numeric type");
});

test("&& on an any type parameter is rejected", () => {
	const { errors } = compile(`package main

func F[T any](a, b T) bool {
	return a && b
}
`);
	assertErrorContains(errors, "operator && not defined on a");
});

test("|| on an int type parameter is rejected", () => {
	const { errors } = compile(`package main

func F[T ~int](a, b T) bool {
	return a || b
}
`);
	assertErrorContains(errors, "operator || not defined on a");
});

test("&& on a ~bool type parameter has the type parameter's type", () => {
	const { errors } = compile(`package main

func F[T ~bool](a, b T) T {
	return a && b
}

func main() {
	_ = F(true, false)
}
`);
	assert(errors.length === 0, errors.map((e) => e.message ?? e).join("\n"));
});

test("shift count of an any type parameter is rejected", () => {
	const { errors } = compile(`package main

func F[T any](x int, s T) int {
	return x << s
}
`);
	assertErrorContains(errors, "shift count");
});

test("compound shift count of an any type parameter is rejected", () => {
	const { errors } = compile(`package main

func F[T any](x int, s T) int {
	x <<= s
	return x
}
`);
	assertErrorContains(errors, "shift count");
});

test("shift count type parameter that is not integer is rejected", () => {
	const { errors } = compile(`package main

func F[T ~int, U any](a T, b U) T {
	return a << b
}
`);
	assertErrorContains(errors, "shift count");
});

test("shift of a type parameter by a fractional constant is rejected", () => {
	const { errors } = compile(`package main

func F[T ~int](a T) T {
	return a << 1.5
}
`);
	assertErrorContains(errors, "not an integer");
});

test("shift of a type parameter by a negative constant is rejected", () => {
	const { errors } = compile(`package main

func F[T ~int](a T) T {
	return a << -1
}
`);
	assertErrorContains(errors, "negative");
});

test("shift of a concrete operand by an integer type parameter is valid", () => {
	const { errors } = compile(`package main

func F[T ~uint](x int, s T) int {
	return x << s
}

func main() {
	_ = F(1, uint(2))
}
`);
	assert(errors.length === 0, errors.map((e) => e.message ?? e).join("\n"));
});

test("== on an any type parameter is rejected", () => {
	const { errors } = compile(`package main

func F[T any](a, b T) bool {
	return a == b
}
`);
	assertErrorContains(errors, "incomparable types in type set");
});

test("== on a slice-constrained type parameter is rejected", () => {
	const { errors } = compile(`package main

func F[T ~[]int](a, b T) bool {
	return a == b
}
`);
	assertErrorContains(errors, "incomparable types in type set");
});

test("!= on a mixed type set with a slice is rejected", () => {
	const { errors } = compile(`package main

func F[T ~int | ~[]int](a, b T) bool {
	return a != b
}
`);
	assertErrorContains(errors, "incomparable types in type set");
});

test("== on a method-only constraint is rejected", () => {
	const { errors } = compile(`package main

func F[T interface{ M() }](a, b T) bool {
	return a == b
}
`);
	assertErrorContains(errors, "incomparable types in type set");
});

test("== on comparable, ordered and nil-comparable type parameters stays valid", () => {
	const { errors } = compile(`package main

import "cmp"

func A[T comparable](a, b T) bool { return a == b }
func B[T cmp.Ordered](a, b T) bool { return a != b }
func C[T ~[]int](a T) bool { return a == nil }
func D[T interface {
	comparable
	M()
}](a, b T) bool {
	return a == b
}

func main() {
	_ = A(1, 2)
	_ = B(1, 2)
	_ = C([]int{})
}
`);
	assert(errors.length === 0, errors.map((e) => e.message ?? e).join("\n"));
});

section("Generics — operands of type-parameter operators");

test("R11.4 an untyped constant shifted by a type parameter keeps its untyped type", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func F[T ~uint8](s T) int { return 1 << s }

func G[T ~uint](s T) {
	x := 1 << s
	fmt.Printf("%T %v\\n", x, x)
}

func H[T ~uint](s T) int { return 1.0 << s }

func main() {
	fmt.Println(F(uint8(10)))
	G(uint(4))
	fmt.Println(H(uint(3)))
}
`,
		"1024\nint 16\n8\n",
	);
});

test("R11.4 a shift by a 64-bit type-parameter count runs on every target", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func A[T ~uint64](s T) {
	x := 1 << s
	fmt.Println(x+1, x == 1024, 1<<s == 1024)
}

func B[T ~uint64](s T) int { return 1 << s }

func C[T ~uint64](s T) int {
	var x int = 1 << s
	return (1 << s) + x
}

func D[T ~uint | ~uint64](s T) int { return 1 << s }

func E[T ~uint64](s T) int {
	a := 1
	b := a << s
	a <<= s
	return a + b
}

func F[T ~uint64](s T) int32 {
	var x int32 = 1 << s
	return x
}

func main() {
	A(uint64(10))
	fmt.Println(B(uint64(10)), C(uint64(10)), D(uint64(10)), D(uint(10)), E(uint64(10)), F(uint64(10)))
	var a int32 = 1
	var c int64 = 3
	var u uint64 = 4
	fmt.Println(a<<c, 1<<u)
}
`,
		"1025 true true\n1024 2048 1024 1024 2048 1024\n8 16\n",
	);
});

test("R11.4 a negative type-parameter shift count panics", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func try(name string, f func()) {
	defer func() { fmt.Println(name, recover()) }()
	f()
}

func G[T ~int32](s T) int32 {
	var x int32 = 1 << s
	return x
}

func H[T ~int](s T) int { return 1 << s }

func L[T ~int](s T) int {
	a := 1
	a <<= s
	return a
}

func main() {
	fmt.Println(G(int32(10)), H(10), L(10))
	try("G", func() { G(int32(-1)) })
	try("H", func() { H(-1) })
	try("L", func() { L(-1) })
}
`,
		"1024 1024 1024\nG runtime error: negative shift amount\nH runtime error: negative shift amount\nL runtime error: negative shift amount\n",
	);
});

test("R14.1 fields of a generic type declared over a struct type", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S[T any] struct{ X T }
type W[T any] S[T]

func main() {
	var w W[int]
	w.X = 42
	fmt.Println(w.X)
	p := &w
	p.X = 7
	fmt.Println(w.X)
	v := W[int]{X: 3}
	v.X++
	fmt.Println(v.X, v)
	ws := []W[int]{{X: 1}}
	ws[0].X = 5
	fmt.Println(ws[0].X)
}
`,
		"42\n7\n4 {4}\n5\n",
	);
});

test("R14.1 methods of a generic type declared over a struct type", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S[T any] struct{ X T }

func (s S[T]) SM() T { return s.X }

type W[T any] S[T]

func (w W[T]) Get() T { return w.X }
func (w *W[T]) Set(v T) { w.X = v }
func (w *W[T]) IsNil() bool { return w == nil }

type Getter interface{ Get() int }
type Niler interface{ IsNil() bool }

func main() {
	w := W[int]{X: 3}
	w.Set(9)
	var g Getter = w
	fmt.Println(w.Get(), g.Get())
	s := S[int]{X: 1}
	w2 := W[int](s)
	w2.X = 2
	fmt.Println(s.X, w2.Get(), S[int](w2).SM())
	var a any = w2
	_, ok := a.(S[int])
	_, ok2 := a.(W[int])
	fmt.Println(ok, ok2)
	var p *W[int]
	var n Niler = p
	fmt.Println(n != nil, n.IsNil())
	var b any = []W[int]{{X: 1}, {X: 2}}
	fmt.Println(b.([]W[int])[1].X)
}
`,
		"9 9\n1 2 2\nfalse true\ntrue true\n2\n",
	);
});

test("defined types over another package's struct get a class", async () => {
	for (const target of ["js", "both", "wasm"]) {
		const directive = target === "js" ? "" : `//gofront:target ${target}\n`;
		const { lines } = await compileHybridProject({
			"sub/sub.go": `${target === "js" ? "" : "//gofront:target both\n"}package sub

type S struct{ X int }
`,
			"main.go": `${directive}package main

import (
	"fmt"
	"./sub"
)

type W[T any] sub.S
type V sub.S

func (w W[T]) Get() int { return w.X }
func (v V) Get() int    { return v.X }

func main() {
	w := W[int]{X: 5}
	w.X++
	v := V(sub.S{X: 2})
	var a any = W[string](sub.S{X: 3})
	_, ok1 := a.(W[string])
	_, ok2 := a.(W[int])
	fmt.Println(w.X, w, w.Get(), v, v.Get(), ok1, ok2)
}
`,
		});
		assertEqual(lines.join("\n"), "6 {6} 6 {2} 2 true false", target);
	}
});

test("converting a struct to a generic defined type tags the target's instantiation", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S[A, B any] struct {
	X A
	Y B
}
type W[A, B any] S[B, A]
type V[A, B any] S[A, int]
type P struct{ X string }
type Q[T any] P

func conv[T any](s S[string, T]) any { return W[T, string](s) }

func main() {
	var a any = W[int, string](S[string, int]{X: "a", Y: 1})
	_, ok1 := a.(W[int, string])
	_, ok2 := a.(W[string, int])
	fmt.Println(ok1, ok2)
	var b any = V[string, bool](S[string, int]{X: "b"})
	_, ok3 := b.(V[string, bool])
	_, ok4 := b.(V[string, int])
	fmt.Println(ok3, ok4)
	var c any = Q[string](P{X: "c"})
	_, ok5 := c.(Q[string])
	_, ok6 := c.(Q[int])
	fmt.Println(ok5, ok6)
	w := W[int, string](S[string, int]{X: "d", Y: 2})
	var d any = S[string, int](w)
	_, ok7 := d.(S[string, int])
	_, ok8 := d.(S[int, string])
	fmt.Println(ok7, ok8)
	e := conv[bool](S[string, bool]{X: "e", Y: true})
	_, ok9 := e.(W[bool, string])
	_, ok10 := e.(W[string, bool])
	fmt.Println(ok9, ok10)
	fmt.Println(a, b, c, d, e)
}
`,
		"true false\ntrue false\ntrue false\ntrue false\ntrue false\n{a 1} {b 0} {c} {d 2} {e true}\n",
	);
});

test("converting between instantiations of one generic type tags the target's", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Phantom[T any] struct{ X int }
type P struct{ X string }
type Q[T any] P
type SameUnder[A, B any] struct {
	X int
	Y string
}

func conv[T any](p Phantom[int]) any { return Phantom[T](p) }

func main() {
	var a any = Phantom[string](Phantom[int]{X: 42})
	_, ok1 := a.(Phantom[string])
	_, ok2 := a.(Phantom[int])
	fmt.Println(ok1, ok2)
	var b any = Q[int](Q[string]{X: "c"})
	_, ok3 := b.(Q[int])
	_, ok4 := b.(Q[string])
	fmt.Println(ok3, ok4)
	var c any = SameUnder[bool, float64](SameUnder[int, string]{X: 1, Y: "hi"})
	_, ok5 := c.(SameUnder[bool, float64])
	_, ok6 := c.(SameUnder[int, string])
	fmt.Println(ok5, ok6)
	d := conv[bool](Phantom[int]{X: 7})
	_, ok7 := d.(Phantom[bool])
	_, ok8 := d.(Phantom[int])
	fmt.Println(ok7, ok8)
	fmt.Println(a, b, c, d)
}
`,
		"true false\ntrue false\ntrue false\ntrue false\n{42} {c} {1 hi} {7}\n",
	);
});

// R12: a builtin's operand in a generic body is checked against the type
// set once, at the definition; instantiating the function (wasm
// monomorphisation) adds no second error and no internal compiler error.
const R12_BUILTINS = [
	["len(v)", "_ = len(v)", "for built-in len"],
	["cap(v)", "_ = cap(v)", "for cap"],
	["clear(v)", "clear(v)", "cannot clear v"],
	["delete(v, 1)", "delete(v, 1)", "is not a map"],
	[
		"append(v, 1)",
		"_ = append(v, 1)",
		"invalid append: argument must be a slice",
	],
	["copy(v, v)", "copy(v, v)", "invalid copy: argument must be a slice"],
	["min(v, v)", "_ = min(v, v)", "cannot be ordered"],
	["max(v, v)", "_ = max(v, v)", "cannot be ordered"],
];

for (const [name, stmt, msg] of R12_BUILTINS) {
	test(`R12 ${name} with T any is one error per definition on every target`, () => {
		const src = `package main

func F[T any](v T) {
	${stmt}
}

func main() {
	F(map[int]int{})
	F([]int{})
}
`;
		for (const target of ["js", "both", "wasm"]) {
			const { errors } = compile(src, { target });
			assertEqual(errors.length, 1);
			assertEqual(errors[0].line, 4);
			assertErrorContains(errors, `v (variable of type T constrained by any)`);
			assertErrorContains(errors, msg);
		}
	});
}

// ═════════════════════════════════════════════════════════════
// Values of type-parameter type
// ═════════════════════════════════════════════════════════════

section("Generics — values of type-parameter type");

const TYPE_PARAM_VALUE_REJECTS = [
	[
		"an int variable assigned to a type parameter",
		`func f[T any]() { var b int; var t T = b; _ = t }
func main() { f[int]() }`,
		"cannot use b (variable of type int) as T value in variable declaration",
	],
	[
		"a type parameter assigned to another",
		`func f[T, U any](t T) { var u U = t; _ = u }
func main() { f[int, int](1) }`,
		"cannot use t (variable of type T constrained by any) as U value in variable declaration",
	],
	[
		"an untyped constant returned as a type parameter of any constraint",
		`func f[T any]() T { return 1 }
func main() { f[int]() }`,
		"cannot use 1 (untyped int constant) as T value in return statement",
	],
	[
		"an untyped constant passed to a type parameter of any constraint",
		`func g[T any](t T) {}
func f[T any]() { g[T](1) }
func main() { f[int]() }`,
		"cannot use 1 (untyped int constant) as T value in argument",
	],
	[
		"a constant no type of the set represents",
		`func f[T ~int | ~float64]() { var t T = 1.5; _ = t }
func main() { f[int]() }`,
		"cannot use 1.5 (untyped float constant) as T value in variable declaration",
	],
	[
		"a type parameter assigned to a concrete type",
		`func f[T any](t T) { var b int = t; _ = b }
func main() { f(1) }`,
		"cannot use t (variable of type T constrained by any) as int value in variable declaration",
	],
	[
		"a forwarded call result of type-parameter type",
		`func g(a, b int) {}
func h[T any](f func() (T, int)) { g(f()) }
func main() { h(func() (int, int) { return 1, 2 }) }`,
		"cannot use f() (value of type T constrained by any) as int value in argument to g",
	],
	[
		"a pointer to a type parameter used as a pointer to an interface",
		`func f[T any](xs *T) { var p *any = xs; _ = p }
func main() { x := 1; f(&x) }`,
		"Cannot assign T to any",
	],
	[
		"a type parameter converted to a type outside its set",
		`func f[T any](t T) string { return string(t) }
func main() { f(1) }`,
		"cannot convert t (variable of type T constrained by any) to type string",
	],
	[
		"a type parameter with a numeric set converted to bool",
		`func f[T ~int | ~float64](t T) bool { return bool(t) }
func main() { f(1) }`,
		"cannot convert int (in T) to type bool",
	],
	[
		"an interface value converted to a type parameter",
		`func f[T any](a any) T { return T(a) }
func main() { f[int](1) }`,
		"need type assertion",
	],
	[
		"a slice of a type parameter converted to a slice of another type",
		`func f[T any](xs []T) []uint { return []uint(xs) }
func main() { f([]int{1}) }`,
		"cannot convert xs (variable of type []T) to type []uint",
	],
	[
		"a slice of a generic struct converted to another instantiation",
		`type S[T any] struct{ X T }
func f[T any](s []S[T]) []S[int] { return []S[int](s) }
func main() { _ = f([]S[string]{{X: "a"}}) }`,
		"cannot convert s (variable of type []S[T]) to type []S[int]",
	],
	[
		"an array of a generic struct converted to another instantiation",
		`type S[T any] struct{ X T }
func f[T any](a [2]S[T]) [2]S[int] { return [2]S[int](a) }
func main() { _ = f([2]S[string]{}) }`,
		"cannot convert a (variable of type [2]S[T]) to type [2]S[int]",
	],
	[
		"a map of a generic struct converted to another instantiation",
		`type S[T any] struct{ X T }
func f[T any](m map[string]S[T]) map[string]S[int] { return map[string]S[int](m) }
func main() { _ = f(map[string]S[string]{}) }`,
		"cannot convert m (variable of type map[string]S[T]) to type map[string]S[int]",
	],
	[
		"a slice of an anonymous struct with a type parameter converted to a concrete one",
		`func f[T any](s []struct{ X T }) []struct{ X int } { return []struct{ X int }(s) }
func main() { _ = f([]struct{ X string }{}) }`,
		"cannot convert s (variable of type []struct",
	],
	[
		"an array of an anonymous struct with a type parameter converted to a concrete one",
		`func f[T any](a [2]struct{ X T }) [2]struct{ X int } { return [2]struct{ X int }(a) }
func main() { _ = f([2]struct{ X string }{}) }`,
		"cannot convert a (variable of type [2]struct",
	],
	[
		"a constant truncated by a type of the set",
		`func f[T ~int | ~float64]() T { return T(1.5) }
func main() { f[int]() }`,
		"cannot convert 1.5 (untyped float constant) to type T",
	],
];

for (const [name, body, msg] of TYPE_PARAM_VALUE_REJECTS) {
	test(`${name} is rejected on every target`, () => {
		for (const target of ["js", "both", "wasm"]) {
			const { errors } = compile(`package main\n${body}`, { target });
			assertErrorContains(errors, msg);
			if (msg.startsWith("cannot use f()"))
				assert(!errors.some((e) => String(e).includes("?:?")), "has position");
		}
	});
}

test("values of type-parameter type that Go accepts still compile", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Num interface{ ~int | ~float64 }
type Str interface{ ~string | ~[]byte }
type Namer interface{ Name() string }
type N struct{}

func (N) Name() string { return "n" }

func same[T any](t T) T { var u T = t; return u }
func zero[T any]() (z T) { return z }
func one[T Num]() T { return 1 }
func conv[T Num](n int) T { return T(n) }
func str[T Str](t T) string { return string(t) }
func box[T any](t T) any { return t }
func name[T Namer](t T) Namer { return t }
func slice[S ~[]int](s S) []int { return s }
func fromSlice[S ~[]int]() S { var s S = []int{1, 2}; return s }
func ptr[T any](p *T) *T { return (*T)(p) }
func nilOf[P ~*int]() P { return nil }

func main() {
	x := 4
	fmt.Println(same(3), zero[int](), one[float64](), conv[float64](2))
	fmt.Println(str("ab"), box(3), name(N{}).Name())
	fmt.Println(slice([]int{1}), fromSlice[[]int](), *ptr(&x), nilOf[*int]() == nil)
}
`,
		"3 0 1 2\nab 3 n\n[1] [1 2] 4 true\n",
	);
});

// ═════════════════════════════════════════════════════════════
// Type parameters through their core type
// ═════════════════════════════════════════════════════════════

section("Generics — core type of a type parameter");

const CORE_TYPE_REJECTS = [
	[
		"range over a float type parameter",
		`func f[T ~float64](x T) { for i := range x { _ = i } }
func main() { f(2.0) }`,
		"cannot range over x (variable of type T constrained by ~float64)",
	],
	[
		"range over a bool type parameter",
		`func f[T ~bool](x T) { for range x {} }
func main() { f(true) }`,
		"cannot range over x (variable of type T constrained by ~bool)",
	],
	[
		"range over a type parameter of any constraint",
		`func f[T any](x T) { for range x {} }
func main() { f(1) }`,
		"cannot range over x (variable of type T constrained by any)",
	],
	[
		"range over a type parameter with a mixed union",
		`func f[T ~[]int | ~string](x T) { for range x {} }
func main() { f("a") }`,
		"cannot range over x (variable of type T constrained by ~[]int | ~string)",
	],
	[
		"range over a type parameter whose core type is not an iterator",
		`func run[F ~func(int)](fn F) { for range fn {} }
func main() { run(func(int) {}) }`,
		"cannot range over func",
	],
	[
		"two iteration variables over a one-value iterator type parameter",
		`func f[A ~func(func(int) bool)](a A) { for i, v := range a { _, _ = i, v } }
func main() {}`,
		"too many loop variables (got 2, max 1)",
	],
	[
		"a field read of a type parameter with a struct core type",
		`func f[T ~struct{ X int }](t T) int { return t.X }
func main() { _ = f(struct{ X int }{1}) }`,
		"t.X undefined (type T has no field or method X)",
	],
	[
		"a field write through a type parameter with a struct core type",
		`func f[T ~struct{ X int }](mk func() T) { mk().X = 1 }
func main() {}`,
		"mk().X undefined (type T has no field or method X)",
	],
	[
		"a field read of a type parameter with a pointer core type",
		`type S struct{ X int }
func f[T interface{ *S }](t T) int { return t.X }
func main() {}`,
		"t.X undefined (type T has no field or method X)",
	],
	[
		"a method the constraint does not declare",
		`type N interface{ M() int }
func f[T N](t T) int { return t.Other() }
func main() {}`,
		"t.Other undefined (type T has no field or method Other)",
	],
];

for (const [name, body, msg] of CORE_TYPE_REJECTS) {
	test(`${name} is rejected on every target`, () => {
		for (const target of ["js", "both", "wasm"]) {
			const { errors } = compile(`package main\n${body}`, { target });
			assertErrorContains(errors, msg);
		}
	});
}

test("a type parameter ranges and calls methods through its constraint", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type N interface{ M() int }
type A struct{}

func (A) M() int { return 3 }

func call[T N](t T) int { return t.M() }
func sum[S ~[]int](s S) int { t := 0; for _, v := range s { t += v }; return t }
func cnt[T ~int](n T) { for i := range n { fmt.Print(i, " ") }; fmt.Println() }

func main() {
	fmt.Println(call(A{}), sum([]int{2, 3}))
	cnt(3)
}`,
		"3 5\n0 1 2 \n",
	);
});

test("dereferencing a value whose type parameter has a pointer core type", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
type S struct{ X int }
func (s S) M() int { return s.X }
func f[T ~*S](t T) int { return (*t).X + (*t).M() }
func main() { s := S{42}; fmt.Println(f(&s)) }`,
		"84\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
