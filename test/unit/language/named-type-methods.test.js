// GoFront test suite — methods on named non-struct types

import { fileURLToPath } from "node:url";
import {
	assertEqual,
	assertErrorContains,
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
