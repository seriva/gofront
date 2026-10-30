// GoFront test suite — methods on named non-struct types

import { fileURLToPath } from "node:url";
import {
	assertEqual,
	assertErrorContains,
	assertProgramOutput,
	compile,
	compileHybrid,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

section("Methods on named func type");

test("named func type with method compiles", () => {
	const { js, errors } = compile(`package main
type Greeter func() string
func (g Greeter) Greet() string { return g() }
func main() {
	f := Greeter(func() string { return "hello" })
	console.log(f.Greet())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello");
});

test("named func type satisfies interface", () => {
	const { js, errors } = compile(`package main
type Stringer interface { String() string }
type MyFunc func() string
func (f MyFunc) String() string { return f() }
func show(s Stringer) { console.log(s.String()) }
func main() {
	f := MyFunc(func() string { return "world" })
	show(f)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "world");
});

test("named func type: calling receiver as function in method body", () => {
	const { js, errors } = compile(`package main
type Handler func(x int) int
func (h Handler) Run(x int) int { return h(x) }
func main() {
	double := Handler(func(x int) int { return x * 2 })
	console.log(double.Run(5))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "10");
});

section("Methods on named slice type");

test("named slice type with method compiles", () => {
	const { js, errors } = compile(`package main
type Ints []int
func (s Ints) Sum() int {
	total := 0
	for _, v := range s {
		total += v
	}
	return total
}
func main() {
	s := Ints{1, 2, 3, 4, 5}
	console.log(s.Sum())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "15");
});

test("named slice type satisfies interface", () => {
	const { js, errors } = compile(`package main
type Stringer interface { String() string }
type Words []string
func (w Words) String() string {
	result := ""
	for i, s := range w {
		if i > 0 { result += " " }
		result += s
	}
	return result
}
func show(s Stringer) { console.log(s.String()) }
func main() {
	w := Words{"hello", "world"}
	show(w)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello world");
});

test("named slice type: append returns named type", () => {
	const { js, errors } = compile(`package main
type Ints []int
func (s Ints) Len() int { return len(s) }
func main() {
	s := Ints{1, 2}
	s = append(s, 3)
	console.log(s.Len())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3");
});

test("named slice type: len works", () => {
	const { js, errors } = compile(`package main
type Strs []string
func main() {
	s := Strs{"a", "b", "c"}
	console.log(len(s))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3");
});

test("named slice type: index access works", () => {
	const { js, errors } = compile(`package main
type Nums []int
func main() {
	n := Nums{10, 20, 30}
	console.log(n[1])
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "20");
});

section("NodeFunc and Group (gom core types)");

test("NodeFunc calls its function when Mount is called", () => {
	const { js, errors } = compile(`package main
type Node interface { Mount(parent any) }
type NodeFunc func(parent any)
func (n NodeFunc) Mount(parent any) { n(parent) }
func main() {
	f := NodeFunc(func(parent any) {
		console.log("mounted")
	})
	f.Mount(nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "mounted");
});

test("Group iterates all nodes on Mount", () => {
	const { js, errors } = compile(`package main
type Node interface { Mount(parent any) }
type NodeFunc func(parent any)
func (n NodeFunc) Mount(parent any) { n(parent) }
type Group []Node
func (g Group) Mount(parent any) {
	for _, n := range g {
		if n != nil { n.Mount(parent) }
	}
}
func main() {
	g := Group{
		NodeFunc(func(parent any) { console.log("a") }),
		NodeFunc(func(parent any) { console.log("b") }),
	}
	g.Mount(nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "a\nb");
});

test("NodeFunc satisfies Node interface", () => {
	const { js, errors } = compile(`package main
type Node interface { Mount(parent any) }
type NodeFunc func(parent any)
func (n NodeFunc) Mount(parent any) { n(parent) }
func run(n Node) { n.Mount(nil) }
func main() {
	f := NodeFunc(func(parent any) { console.log("ok") })
	run(f)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "ok");
});

test("Group satisfies Node interface", () => {
	const { js, errors } = compile(`package main
type Node interface { Mount(parent any) }
type NodeFunc func(parent any)
func (n NodeFunc) Mount(parent any) { n(parent) }
type Group []Node
func (g Group) Mount(parent any) {
	for _, n := range g {
		if n != nil { n.Mount(parent) }
	}
}
func run(n Node) { n.Mount(nil) }
func main() {
	g := Group{NodeFunc(func(parent any) { console.log("ok") })}
	run(g)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "ok");
});

// Values of named non-struct types stay raw in JS; methods dispatch statically and
// the value is boxed only inside interfaces. Expected output captured from Go.
section("Named non-struct types behave like their underlying values");

test("named basic type: zero value, arithmetic, comparison and map keys", () => {
	const { js, errors } = compile(`package main
import "fmt"
type Celsius float64
func (c Celsius) F() float64 { return float64(c)*9/5 + 32 }
func (c Celsius) Warmer(d Celsius) Celsius { return c + d }
func main() {
	var c Celsius = 100
	d := c + 10
	fmt.Println(c.F(), d.F(), c.Warmer(5).F(), (c * 2).F())
	fmt.Println(c < d, c == Celsius(100), c == 100, float64(c)+1)
	m := map[Celsius]string{c: "boil"}
	fmt.Println(m[Celsius(100)], m[100], len(m))
	var z Celsius
	fmt.Println(float64(z), z == 0, z.F())
	f := c.F
	c = 0
	fmt.Println(f(), Celsius.F(37))
}`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		[
			"212 230 221 392",
			"true true true 101",
			"boil boil 1",
			"0 true 32",
			"212 98.6",
		].join("\n"),
	);
});

test("pointer-receiver methods on named basic types update the variable", () => {
	const { js, errors } = compile(`package main
import "fmt"
type Level int
func (l *Level) Set(v int) { *l = Level(v) }
func (l Level) Get() int   { return int(l) }
func (l *Level) Inc()      { *l++ }
type Box struct {
	L  Level
	PL *Level
}
func main() {
	var l Level
	l.Set(5)
	l.Inc()
	fmt.Println(l.Get(), int(l))
	var b Box
	b.L.Set(9)
	b.L.Inc()
	b.PL = &l
	b.PL.Set(42)
	fmt.Println(b.L.Get(), l.Get(), b.PL.Get())
	levels := []Level{1, 2}
	levels[1].Set(20)
	fmt.Println(levels[0].Get(), levels[1].Get())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), ["6 6", "10 42 42", "1 20"].join("\n"));
});

test("named values in interfaces: dispatch, assertions and type switches", () => {
	const { js, errors } = compile(`package main
import "fmt"
type Celsius float64
func (c Celsius) F() float64 { return float64(c)*9/5 + 32 }
type Level int
func (l *Level) Set(v int) { *l = Level(v) }
func (l Level) Get() int   { return int(l) }
type Setter interface{ Set(v int) }
type Getter interface{ Get() int }
type Fer interface{ F() float64 }
type Names []string
func (n Names) Count() int { return len(n) }
func kind(v any) string {
	switch x := v.(type) {
	case Celsius:
		return fmt.Sprintf("Celsius %.1f", x.F())
	case Level:
		return fmt.Sprintf("Level %d", x.Get())
	case *Level:
		return fmt.Sprintf("*Level %d", x.Get())
	case float64:
		return "float64"
	case Names:
		return fmt.Sprintf("Names %d", x.Count())
	default:
		return "other"
	}
}
func main() {
	var fer Fer = Celsius(110)
	fmt.Println(fer.F())
	if cc, ok := fer.(Celsius); ok {
		fmt.Println("assert", float64(cc)+0.5)
	}
	_, bad := fer.(interface{ Get() int })
	fmt.Println(bad)
	var l Level
	var s Setter = &l
	s.Set(77)
	var g Getter = &l
	fmt.Println(l.Get(), g.Get())
	var g2 Getter = l
	l.Set(1)
	fmt.Println(g2.Get(), l.Get())
	fmt.Println(kind(Celsius(20)), kind(Level(4)), kind(&l), kind(1.5), kind(Names{"x"}), kind("s"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		[
			"230",
			"assert 110.5",
			"false",
			"77 77",
			"77 1",
			"Celsius 68.0 Level 4 *Level 1 float64 Names 1 other",
		].join("\n"),
	);
});

test("named string errors compare like Go values (==, switch, errors.Is, errors.As)", () => {
	const { js, errors } = compile(`package main
import (
	"errors"
	"fmt"
)
type MyErr string
func (e MyErr) Error() string { return "myerr: " + string(e) }
const ErrNotFound MyErr = "not found"
func find(k string) error {
	if k == "x" {
		return ErrNotFound
	}
	if k == "y" {
		return MyErr("other")
	}
	return nil
}
func main() {
	err := find("x")
	fmt.Println(err == ErrNotFound, err != nil, errors.Is(err, ErrNotFound), err.Error())
	err2 := find("y")
	fmt.Println(err2 == ErrNotFound, err2.Error(), find("z") == nil)
	switch err {
	case ErrNotFound:
		fmt.Println("switch: not found")
	default:
		fmt.Println("switch: default")
	}
	var me MyErr
	fmt.Println(errors.As(err, &me), string(me))
	fmt.Println(err)
}`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		[
			"true true true myerr: not found",
			"false myerr: other true",
			"switch: not found",
			"true not found",
			"myerr: not found",
		].join("\n"),
	);
});

test("named slice, map and func types: nil, append, range and assignment from literals", () => {
	const { js, errors } = compile(`package main
import (
	"fmt"
	"strings"
)
type Names []string
func (n Names) Count() int    { return len(n) }
func (n Names) Join() string  { return strings.Join(n, "+") }
func (n *Names) Add(s string) { *n = append(*n, s) }
type Counts map[string]int
func (c Counts) Total() int {
	t := 0
	for _, v := range c {
		t += v
	}
	return t
}
type Op func(int) int
func (o Op) Twice(x int) int { return o(o(x)) }
func main() {
	var n Names
	fmt.Println(n == nil, n.Count(), len(n))
	n = Names{"a", "b"}
	n = append(n, "c")
	n.Add("d")
	fmt.Println(n.Count(), n.Join(), n[1], len(n))
	plain := []string{"p", "q"}
	n = plain
	fmt.Println(Names(plain).Join(), n.Count())
	cnt := Counts{"a": 1, "b": 2}
	cnt["c"] = 3
	fmt.Println(cnt.Total(), len(cnt))
	op := Op(func(x int) int { return x * 3 })
	fmt.Println(op(2), op.Twice(2))
}`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		["true 0 0", "4 a+b+c+d b 4", "p+q 2", "6 3", "6 18"].join("\n"),
	);
});

test("assigning an unnamed type literal to a named type with the same underlying type", () => {
	const { errors } = compile(`package main
type Names []string
type Celsius float64
func use(n Names) int { return len(n) }
func main() {
	var n Names = []string{"a"}
	_ = use([]string{"b"})
	_ = n
	var f float64 = 1
	var c Celsius = f
	_ = c
}`);
	assertEqual(errors.length, 1);
	assertErrorContains(errors, "Cannot assign float64 to Celsius");
});

section("Type errors");

test("method on named type: wrong receiver type is a type error", () => {
	const { errors } = compile(`package main
type MySlice []int
func (s MySlice) First() int { return s[0] }
func main() {
	var x int = 5
	x.First()
}`);
	assertErrorContains(errors, "First");
});

section("Package-level named scalars (Task 0.28)");

test("a pointer-receiver call on a package-level named scalar writes through (P29)", () => {
	const { js, errors } = compile(`package main

type C int

func (c *C) Inc() { *c++ }

var g C

func twice() {
	g.Inc()
	g.Inc()
}

func main() {
	twice()
	console.log(int(g))
	p := &g
	*p += 10
	console.log(int(g))
}
`);
	assertEqual(errors.length, 0, errors.join("\n"));
	assertEqual(runJs(js), "2\n12");
});

section("Named types with methods through pointers (Task 0.34)");

test("value method called through a pointer to a named scalar (P26)", () => {
	const res = compileHybrid(`package main
type N int
func (n N) Get() int { return int(n) }
func Main() int {
	n := N(3)
	p := &n
	return p.Get()
}`).run("Main");
	assertEqual(res.wasmRes, 3n);
	assertEqual(res.jsRes, 3);
});

test("pointer-receiver method on a named slice writes the header back (P28)", () => {
	const res = compileHybrid(`package main
type L []int
func (l *L) Add(v int) { *l = append(*l, v) }
func Main() int {
	var l L
	l.Add(1)
	l.Add(2)
	return len(l)
}`).run("Main");
	assertEqual(res.wasmRes, 2n);
	assertEqual(res.jsRes, 2);
});

section("Defined types over named structs");

test("type S3 Base keeps the fields of Base on every target", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type Base struct{ n int }
type S3 Base

func (s S3) N() int { return s.n }

func main() {
	fmt.Println(S3{n: 5}.N())
}
`,
		"5\n",
	);
});

test("converting to a defined struct type uses its methods (value receiver)", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type Base struct{ n int }
type S3 Base

func (s S3) M() int { return s.n * 2 }

func main() {
	b := Base{4}
	fmt.Println(S3(b).M())
}
`,
		"8\n",
	);
});

test("converting to a defined struct type uses its methods (pointer receiver, copy)", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type Base struct{ n int }
type S3 Base

func (s *S3) Inc() { s.n++ }

func main() {
	b := Base{7}
	s := S3(b)
	s.Inc()
	fmt.Println(s.n, b.n)
	t := S3(Base{1})
	t.Inc()
	fmt.Println(t.n)
}
`,
		"8 7\n2\n",
	);
});

test("promoted fields of an embedded struct through a defined type", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type In struct{ v int }
type Base struct {
	In
	n int
}
type A Base

func main() {
	a := A{In{1}, 2}
	fmt.Println(a.v, a.n)
}
`,
		"1 2\n",
	);
});

test("explicit conversion to an interface boxes named basic types", () => {
	const { js, errors } = compile(`package main
type L string
type Level int
type N int
func main() {
	console.log(any(L("x")).(L))
	z := any(Level(1))
	console.log(z.(Level) + 1)
	var e any = N(2)
	console.log(e == any(N(2)))
	_, ok := any(L("x")).(string)
	console.log(ok)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "x\n2\ntrue\nfalse");
});

test("interface-keyed maps keep named and plain keys distinct", () => {
	const { js, errors } = compile(`package main
import "fmt"
type L string
type N int
func main() {
	set := map[any]bool{}
	set[any(L("a"))] = true
	set[any(L("b"))] = true
	fmt.Println(len(set), set[any(L("a"))])
	m := map[any]int{}
	var k any = L("a")
	m[k] = 1
	m[any(N(1))] = 2
	fmt.Println(len(m), m[k], m[any(L("a"))], m[any(N(1))])
	m2 := map[any]int{}
	m2[L("a")] = 1
	var k2 any = L("a")
	fmt.Println(m2[k2])
	m3 := map[any]int{L("a"): 1, N(1): 2, "1": 3, 1: 4, L("1"): 5}
	fmt.Println(len(m3), m3[L("a")], m3[N(1)], m3["1"], m3[1], m3[L("1")])
	m3[L("a")] += 10
	n := 0
	for key, v := range m3 {
		if l, ok := key.(L); ok && l == "a" { n += v }
		if x, ok := key.(N); ok && x == 1 { n += v * 100 }
	}
	fmt.Println(n)
	v, ok := m3[any(L("a"))]
	fmt.Println(v, ok)
	delete(m3, L("a"))
	_, ok = m3[L("a")]
	fmt.Println(len(m3), ok)
	m4 := map[any]int{"x": 1, 2: 2, struct{ A int }{1}: 3}
	fmt.Println(len(m4), m4["x"], m4[2], m4[struct{ A int }{1}])
}`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		"2 true\n2 1 1 2\n1\n5 1 2 3 4 5\n211\n11 true\n4 false\n3 1 2 3",
	);
});

test("interface-keyed map literals encode keys when named, nested or elided", () => {
	const { js, errors } = compile(`package main

import (
	"errors"
	"fmt"
)

type L string
type M map[any]int
type Named map[any]int
type E map[error]int
type S map[fmt.Stringer]int
type Str string

func (s Str) String() string { return string(s) }

func main() {
	x := M{1: 1}
	fmt.Println(x[1])
	a := map[string]map[any]int{"a": {1: 2}}
	fmt.Println(a["a"][1])
	b := []map[any]int{{1: 2}}
	fmt.Println(b[0][1])
	c := [1]map[any]int{{1: 1}}
	fmt.Println(c[0][1])
	d := map[any]map[any]int{1: {2: 3}}
	fmt.Println(d[1][2])
	n := Named{L("x"): 1, "x": 2, 3: 4}
	fmt.Println(len(n), n[L("x")], n["x"], n[3])
	e1 := errors.New("e")
	e := E{e1: 5}
	fmt.Println(e[e1])
	ee := []map[error]int{{e1: 6}}
	fmt.Println(ee[0][e1])
	s := S{Str("q"): 7}
	fmt.Println(s[Str("q")])
	ss := map[string]S{"k": {Str("z"): 8}}
	fmt.Println(ss["k"][Str("z")])
	f := map[string]any{"a": 1}
	_ = f
	g := map[any]int{"s": 1, 2: 2}
	fmt.Println(g["s"], g[2])
	h := map[string]Named{"a": {L("y"): 9, 1: 10}}
	fmt.Println(h["a"][L("y")], h["a"][1])
	var p *map[any]int
	_ = p
	m2 := map[any]int{L("a"): 1}
	m2[L("a")]++
	m2[L("a")] += 3
	fmt.Println(m2[L("a")])
}
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n2\n2\n1\n3\n3 1 2 4\n5\n6\n7\n8\n1 2\n9 10\n5");
});

test("generic functions key map[any] like plain code", () => {
	const { js, errors } = compile(`package main

import "fmt"

type L string
type K struct {
	A string
	B int
}

func Inc[K comparable](m map[K]int, k K) { m[k]++ }
func Set[K comparable, V any](m map[K]V, k K, v V) { m[k] = v }
func Get[K comparable, V any](m map[K]V, k K) V { return m[k] }
func Has[K comparable, V any](m map[K]V, k K) bool { _, ok := m[k]; return ok }
func Del[K comparable, V any](m map[K]V, k K) { delete(m, k) }
func Add[K comparable](m map[K]int, k K, n int) { m[k] += n }
func Put[K comparable](m map[any]int, k K) { m[k] = 5 }
func Cnt[K comparable](m map[K]int) int { return len(m) }
func Lit[K comparable](k K) map[K]int { return map[K]int{k: 3} }
func Rng[K comparable](m map[K]int) int {
	n := 0
	for k, v := range m {
		_ = k
		n += v
	}
	return n
}
func Keys[K comparable](m map[K]int) []K {
	var r []K
	for k := range m {
		r = append(r, k)
	}
	return r
}

func main() {
	g := map[any]int{}
	Inc(g, any(1))
	fmt.Println(g[1])
	Set(g, any(2), 5)
	fmt.Println(g[2])
	g[3] = 7
	fmt.Println(Get(g, any(3)))
	fmt.Println(Has(g, any(3)), Has(g, any(4)))
	Add(g, any(1), 10)
	fmt.Println(g[1], Cnt(g), Rng(g))
	Del(g, any(1))
	fmt.Println(len(g))
	m := map[any]int{}
	Put(m, L("a"))
	fmt.Println(m[L("a")], m["a"])
	Put(m, 7)
	fmt.Println(m[7])
	Inc(g, any(L("z")))
	fmt.Println(g[L("z")])
	for _, k := range Keys(g) {
		_ = k
	}
	l := Lit(any(L("q")))
	fmt.Println(l[L("q")])
	l2 := Lit(5)
	fmt.Println(l2[5])
	l3 := Lit("s")
	fmt.Println(l3["s"])

	mi := map[int]int{}
	Inc(mi, 4)
	Set(mi, 5, 6)
	fmt.Println(mi, Get(mi, 5))
	ms := map[string]int{}
	Inc(ms, "a")
	Set(ms, "b", 2)
	fmt.Println(ms, Get(ms, "b"), Rng(ms))
	mk := map[K]int{}
	Inc(mk, K{"a", 1})
	Inc(mk, K{"a", 1})
	Set(mk, K{"b", 2}, 9)
	fmt.Println(mk, Get(mk, K{"a", 1}), Has(mk, K{"b", 2}), Rng(mk))
	mka := map[any]int{}
	Inc(mka, any(K{"a", 1}))
	Set(mka, any(K{"a", 1}), 4)
	fmt.Println(mka[K{"a", 1}], len(mka))
}
`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		"1\n5\n7\ntrue false\n11 3 23\n2\n5 0\n5\n1\n3\n3\n3\nmap[4:1 5:6] 6\nmap[a:1 b:2] 2 3\nmap[{a 1}:2 {b 2}:9] 2 true 11\n4 1",
	);
});

test("generic types key map[K] by the instantiated type", () => {
	const { js, errors } = compile(`package main

import "fmt"

type L string
type P struct{ X, Y int }
type USet[K comparable] struct{ m map[K]int }

func NewUSet[K comparable]() *USet[K] { return &USet[K]{m: map[K]int{}} }
func (s *USet[K]) Add(k K)           { s.m[k]++ }
func (s *USet[K]) Has(k K) bool      { _, ok := s.m[k]; return ok }
func (s *USet[K]) Count(k K) int     { return s.m[k] }
func (s *USet[K]) Del(k K)           { delete(s.m, k) }

func Wrap[K comparable](m map[any]int, k K) int { m[k] += 2; return m[k] }
func Outer[K comparable](m map[K]int, k K) { Inc2(m, k); Inc2(m, k) }
func Inc2[K comparable](m map[K]int, k K) { m[k]++ }

func main() {
	a := NewUSet[any]()
	a.Add(L("x"))
	a.Add("x")
	a.Add(1)
	a.Add(1)
	fmt.Println(a.Has(L("x")), a.Has("x"), a.Count(1), a.Has(2), len(a.m))
	a.Del(1)
	fmt.Println(a.Has(1))
	b := NewUSet[int]()
	b.Add(3)
	fmt.Println(b.Has(3), b.Count(3), b.m)
	c := NewUSet[P]()
	c.Add(P{1, 2})
	c.Add(P{1, 2})
	fmt.Println(c.Count(P{1, 2}), c.Has(P{2, 1}), len(c.m))
	d := NewUSet[string]()
	d.Add("q")
	fmt.Println(d.m, d.Has("q"))
	m := map[any]int{}
	fmt.Println(Wrap(m, 5), Wrap(m, L("z")), Wrap(m, "z"), Wrap(m, 5), m[5], m[L("z")], m["z"])
	g := map[any]int{}
	Outer(g, any(L("k")))
	fmt.Println(g[L("k")], len(g))
	e := NewUSet[L]()
	e.Add("a")
	fmt.Println(e.Has("a"), e.m)
}
`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		"true true 2 false 3\nfalse\ntrue 1 map[3:1]\n2 false 1\nmap[q:1] true\n2 2 2 4 4 2 2\n2 1\ntrue map[a:1]",
	);
});

test("named map literals with struct keys compile", () => {
	const { js, errors } = compile(`package main

import "fmt"

type K struct {
	A string
	B int
}
type KS map[K]int

func main() {
	x := KS{{"x", 1}: 9}
	fmt.Println(x[K{"x", 1}], len(x))
	y := map[string]KS{"a": {{"q", 2}: 3}}
	fmt.Println(y["a"][K{"q", 2}])
}
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "9 1\n3");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
