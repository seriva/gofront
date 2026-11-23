// GoFront test suite — a method is kept by the type it is selected on, not by its name alone

import {
	assert,
	assertEqual,
	compile,
	runJs,
	section,
	test,
} from "../helpers.js";

section("JS output — method reachability is receiver-qualified");

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

test("a user Len and Reset no longer keep strings.Builder.Len and Reset", () => {
	const js = jsOf(`package main
import "strings"
type Counter struct{ n int }
func (c *Counter) Len() int { return c.n }
func (c *Counter) Reset() { c.n = 0 }
func main() {
	var sb strings.Builder
	sb.WriteString("hi")
	c := &Counter{n: 2}
	c.Reset()
	println(sb.String(), c.Len())
}
`);
	const builder = classBody(js, "Builder$$strings");
	assert(builder.includes("WriteString("), "WriteString is kept");
	assert(builder.includes("String("), "String is kept");
	assert(!builder.includes("Len("), "Builder.Len is omitted");
	assert(!builder.includes("Reset("), "Builder.Reset is omitted");
	const counter = classBody(js, "Counter");
	assert(counter.includes("Len(") && counter.includes("Reset("));
	assertEqual(runJs(js), "hi 0");
});

test("selecting a stdlib method keeps it, and only on its type", () => {
	const js = jsOf(`package main
import "strings"
type Counter struct{ n int }
func (c *Counter) Len() int { return c.n }
func main() {
	var sb strings.Builder
	sb.WriteString("hi")
	println(sb.Len())
	_ = &Counter{}
}
`);
	assert(
		classBody(js, "Builder$$strings").includes("Len("),
		"Builder.Len kept",
	);
	assert(!classBody(js, "Counter").includes("Len("), "Counter.Len omitted");
	assertEqual(runJs(js), "2");
});

test("a method named by the other type of the same name is omitted", () => {
	const js = jsOf(`package main
type A struct{}
func (A) Val() int { return 1 }
type B struct{}
func (B) Val() int { return 2 }
func main() {
	println(A{}.Val())
	_ = B{}
}
`);
	assert(classBody(js, "A").includes("Val("), "A.Val kept");
	assert(!classBody(js, "B").includes("Val("), "B.Val omitted");
	assertEqual(runJs(js), "1");
});

test("a call on a generic receiver keeps the method of its base type", () => {
	const js = jsOf(`package main
type Box[T any] struct{ v T }
func (b Box[T]) Val() T { return b.v }
func (b Box[T]) Unused() T { return b.v }
type Other struct{}
func (Other) Val() int { return 9 }
func main() {
	b := Box[int]{v: 7}
	println(b.Val())
	_ = Other{}
}
`);
	assert(classBody(js, "Box").includes("Val("), "Box.Val kept");
	assert(!js.includes("Unused"), "Box.Unused omitted");
	assert(!classBody(js, "Other").includes("Val("), "Other.Val omitted");
	assertEqual(runJs(js), "7");
});

test("method expressions T.M and (*T).M keep the method", () => {
	const js = jsOf(`package main
type Plain struct{ n int }
func (p Plain) M() int { return p.n + 1 }
func (p *Plain) P() int { return p.n + 2 }
func (p Plain) Skipped() int { return 0 }
type Other struct{}
func (Other) M() int { return 9 }
func (*Other) P() int { return 9 }
func main() {
	f := Plain.M
	g := (*Plain).P
	println(f(Plain{n: 1}), g(&Plain{n: 1}))
	_ = Other{}
}
`);
	const plain = classBody(js, "Plain");
	assert(plain.includes("M(") && plain.includes("P("), "M and P kept");
	assert(!js.includes("Skipped"), "Skipped omitted");
	const other = classBody(js, "Other");
	assert(!other.includes("M(") && !other.includes("P("), "Other has neither");
	assertEqual(runJs(js), "2 3");
});

test("a method value keeps the method of its receiver type", () => {
	const js = jsOf(`package main
type A struct{ n int }
func (a A) Get() int { return a.n }
type B struct{}
func (B) Get() int { return 0 }
func main() {
	f := A{n: 4}.Get
	println(f())
	_ = B{}
}
`);
	assert(classBody(js, "A").includes("Get("));
	assert(!classBody(js, "B").includes("Get("));
	assertEqual(runJs(js), "4");
});

test("a promoted call keeps the method on every embedded type down the chain", () => {
	const js = jsOf(`package main
type Inner struct{ n int }
func (i *Inner) Used() int { return i.n }
func (i *Inner) Dead() int { return i.n }
type Mid struct{ Inner }
type Outer struct{ *Mid }
type Stranger struct{}
func (*Stranger) Used() int { return 5 }
func main() {
	o := Outer{&Mid{Inner{n: 3}}}
	println(o.Used())
	_ = Stranger{}
}
`);
	assert(classBody(js, "Inner").includes("Used("), "Inner.Used kept");
	assert(!js.includes("Dead"), "Inner.Dead omitted");
	assert(
		!classBody(js, "Stranger").includes("Used("),
		"an unrelated type's Used is omitted",
	);
	assertEqual(runJs(js), "3");
});

test("an interface call keeps the method on every reached type", () => {
	const js = jsOf(`package main
type Getter interface{ Get() int }
type A struct{}
func (A) Get() int { return 1 }
type B struct{}
func (B) Get() int { return 2 }
func (B) Other() int { return 3 }
func use(g Getter) int { return g.Get() }
func main() {
	println(use(A{}), use(B{}))
}
`);
	assert(classBody(js, "A").includes("Get("));
	assert(classBody(js, "B").includes("Get("));
	assert(!js.includes("Other"), "Other is not selected");
	assertEqual(runJs(js), "1 2");
});

test("a call through a type parameter keeps the method on every reached type", () => {
	const js = jsOf(`package main
type Getter interface{ Get() int }
type A struct{}
func (A) Get() int { return 1 }
type B struct{}
func (B) Get() int { return 2 }
func use[T Getter](t T) int { return t.Get() }
func main() {
	println(use(A{}), use(B{}))
}
`);
	assert(classBody(js, "A").includes("Get("));
	assert(classBody(js, "B").includes("Get("));
	assertEqual(runJs(js), "1 2");
});

test("a method of a type reached through any stays when a reached interface names it", () => {
	const js = jsOf(`package main
type Namer interface{ Name() string }
type A struct{}
func (A) Name() string { return "a" }
func main() {
	var v any = A{}
	if n, ok := v.(Namer); ok {
		println(n.Name())
	}
}
`);
	assert(classBody(js, "A").includes("Name("));
	assertEqual(runJs(js), "a");
});

test("a method promoted from an embedded interface is called through it", () => {
	const js = jsOf(`package main
type Getter interface{ Get() int }
type A struct{}
func (A) Get() int { return 1 }
func (A) Spare() int { return 2 }
type Holder struct{ Getter }
func main() {
	h := Holder{A{}}
	println(h.Get())
}
`);
	assert(classBody(js, "A").includes("Get("), "A.Get kept for the interface");
	assert(!js.includes("Spare"), "Spare omitted");
	assertEqual(runJs(js), "1");
});

test("a method declared on an alias is not dropped by a selection on the type", () => {
	// Running it still fails for a separate reason (the alias has no class);
	// the declaration has to stay in the output for that to be fixable.
	const js = jsOf(`package main
type P struct{ n int }
type A = P
func (a A) Get() int { return a.n }
func main() {
	var a A
	println(a.Get())
}
`);
	assert(js.includes("Get("), "the method on the alias is kept");
});
