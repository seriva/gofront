// GoFront test suite — methods nothing selects are left out of the JS bundle

import { resolve } from "node:path";
import { compileDir } from "../../../src/compiler.js";
import { Lexer } from "../../../src/lexer/lexer.js";
import { computeEmbeddedStubs } from "../../../src/lower/embedding.js";
import { Parser } from "../../../src/parser/index.js";
import { TypeChecker } from "../../../src/typechecker/index.js";
import {
	assert,
	assertEqual,
	compile,
	runJs,
	section,
	test,
	withTempDir,
} from "../helpers.js";

section("JS output — unselected methods are pruned");

function jsOf(source) {
	const { js, errors } = compile(source);
	assert(js !== null, `compile failed: ${errors?.map((e) => e.message)}`);
	return js;
}

// The text of `class <name> { … }` in `js`.
function classBody(js, name) {
	const start = js.indexOf(`class ${name} `);
	assert(start >= 0, `class ${name} is emitted`);
	const end = js.indexOf("\n}\n", start);
	return js.slice(start, end);
}

test("an unselected method is absent from the class, stubs, __vm and __pm", () => {
	const js = jsOf(`package main
type Inner struct{ n int }
func (i *Inner) Used() int { return i.n }
func (i *Inner) PtrUnused() int { return i.n }
func (i Inner) ValUnused() int { return i.n }
type Outer struct {
	Inner
	x int
}
func (o *Outer) Own() int { return o.x }
func (o *Outer) OwnUnused() int { return o.x }
func (o Outer) OwnValUnused() int { return o.x }
func main() {
	o := &Outer{}
	println(o.Used(), o.Own())
}
`);
	for (const name of ["PtrUnused", "ValUnused", "OwnUnused", "OwnValUnused"])
		assert(!js.includes(name), `${name} is omitted everywhere`);
	const outer = classBody(js, "Outer");
	assert(outer.includes("Used(...__a)"), "the used promotion keeps its stub");
	assert(outer.includes("Own()"));
	assertEqual(runJs(js), "0 0");
});

test("a method named by a reached interface stays on every type", () => {
	const js = jsOf(`package main
type Speaker interface{ Speak() string }
type Dog struct{}
func (Dog) Speak() string { return "woof" }
func (Dog) Fetch() string { return "stick" }
type Cat struct{}
func (Cat) Speak() string { return "meow" }
func talk(s Speaker) { println(s.Speak()) }
func main() {
	talk(Dog{})
	talk(Cat{})
	var x any = Dog{}
	_, ok := x.(Speaker)
	println(ok)
}
`);
	assert(!js.includes("Fetch"), "Fetch is omitted");
	assertEqual(runJs(js), "woof\nmeow\ntrue");
});

test("a method value and a method expression keep the method", () => {
	const js = jsOf(`package main
type T struct{ n int }
func (t T) Value() int { return t.n }
func (t *T) Ptr() int { return t.n + 1 }
func (t T) Dead() int { return 0 }
func main() {
	t := T{n: 1}
	f := t.Value
	g := (*T).Ptr
	h := T.Value
	println(f(), g(&t), h(t))
}
`);
	assert(!js.includes("Dead"));
	assertEqual(runJs(js), "1 2 1");
});

test("a method promoted through embedding stays with its stub", () => {
	const js = jsOf(`package main
type Base struct{ n int }
func (b *Base) Inc() { b.n++ }
func (b *Base) Get() int { return b.n }
func (b *Base) Dead() int { return -1 }
type Mid struct{ Base }
type Top struct{ Mid }
func main() {
	t := &Top{}
	t.Inc()
	t.Inc()
	println(t.Get())
}
`);
	assert(!js.includes("Dead"));
	assertEqual(runJs(js), "2");
});

test("an embedded interface forwards only the selected methods", () => {
	const js = jsOf(`package main
type Walker interface {
	Walk() string
	Run() string
}
type Legs struct{}
func (Legs) Walk() string { return "walk" }
func (Legs) Run() string { return "run" }
type Robot struct{ Walker }
func main() {
	r := Robot{Walker: Legs{}}
	println(r.Walk())
}
`);
	assertEqual(runJs(js), "walk");
});

test("the methods implicit callers use are kept", () => {
	const js = jsOf(`package main
import "fmt"
type T struct{ n int }
func (t T) String() string { return fmt.Sprint("T", t.n) }
func (t T) Error() string { return "err" }
func (t T) Dead() int { return 0 }
func main() {
	var v any = T{3}
	fmt.Println(v)
}
`);
	assert(!js.includes("Dead"));
	assertEqual(runJs(js), "err");
});

test("a type whose values reach JavaScript keeps all its methods", () => {
	const js = jsOf(`package main
type Handler struct{ n int }
func (h *Handler) Handle() {}
func (h *Handler) HandleEvent() int { return h.n }
type Quiet struct{ n int }
func (q *Quiet) Dead() int { return q.n }
func main() {
	h := &Handler{}
	el := document.getElementById("x")
	el.addEventListener("click", h)
	q := &Quiet{}
	println(q.n)
}
`);
	assert(js.includes("HandleEvent()"), "an escaping type keeps every method");
	assert(js.includes("Handle()"));
	assert(!js.includes("Dead"), "a type that stays in Go does not");
});

test("a value handed to a JS-dynamic value keeps its methods", () => {
	const js = jsOf(`package main
type Cfg struct{ n int }
func (c Cfg) ToJS() int { return c.n }
func main() {
	c := Cfg{n: 1}
	console.log(c)
}
`);
	assert(js.includes("ToJS()"));
});

test("a named non-struct type boxed into any still emits its box class", () => {
	const js = jsOf(`package main
type Celsius float64
func (c Celsius) Never() float64 { return float64(c) }
func main() {
	var a any = Celsius(1)
	_, ok := a.(Celsius)
	println(ok)
}
`);
	assert(!js.includes("Never"));
	assertEqual(runJs(js), "true");
});

test("pruning an outer method never promotes the inner embedded method", () => {
	const source = `package main
type Inner struct{}
func (Inner) Get() int { return 1 }
type Outer struct{ Inner }
func (Outer) Get() int { return 2 }
func main() {}
`;
	const ast = new Parser(
		new Lexer(source, "main.go").tokenize(),
		"main.go",
		source,
	).parse();
	const checker = new TypeChecker();
	assertEqual(checker.check(ast).length, 0);
	// `Outer.Get` was pruned from the declarations the backend sees.
	const stubs = computeEmbeddedStubs("Outer", [], checker);
	assertEqual(stubs.map((s) => s.methodName).join(), "");
});

test("a package without main keeps the exported methods of its types", () => {
	const js = withTempDir(
		{
			"lib.go": `package lib
type Shape struct{ W int }
func (s Shape) Area() int { return s.W }
type hidden struct{ W int }
func (h hidden) Area() int { return h.W }
func (h hidden) spare() int { return h.W }
func Total() int { return hidden{W: 1}.Area() }
`,
		},
		(dir) => compileDir(resolve(dir)).js,
	);
	assert(js.includes("class Shape"), "the exported type is kept");
	assert(js.includes("Area()"), "its exported method is kept");
	assert(
		!js.includes("spare"),
		"an unexported type keeps only what is selected",
	);
});

test("a method of another package is kept when selected there", () => {
	const { js, out } = withTempDir(
		{
			"main.go": `package main
import "./util"
func main() {
	b := util.NewBox(4)
	println(b.Get())
}
`,
			"util/u.go": `package util
type Box struct{ v int }
func NewBox(v int) *Box { return &Box{v: v} }
func (b *Box) Get() int { return b.v }
func (b *Box) Unused() int { return b.v }
`,
		},
		(dir) => {
			const res = compileDir(resolve(dir));
			return { js: res.js, out: runJs(res.js) };
		},
	);
	assert(!js.includes("Unused"));
	assertEqual(out, "4");
});
