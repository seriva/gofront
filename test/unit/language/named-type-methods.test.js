// GoFront test suite — methods on named non-struct types

import { fileURLToPath } from "node:url";
import {
	assertEqual,
	assertErrorContains,
	compile,
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
