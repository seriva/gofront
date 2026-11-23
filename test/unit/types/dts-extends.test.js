// GoFront test suite — `.d.ts` interface inheritance and assertions
//
// `interface Child extends Base` inherits members, a derived interface is
// assignable to its base, and `x.(Child)` on a `.d.ts` interface value passes
// the value through (JavaScript has no runtime type to test).

import { fileURLToPath } from "node:url";
import {
	assert,
	assertContains,
	assertEqual,
	assertErrorContains,
	compileDts,
	section,
	summarize,
	test,
} from "../helpers.js";

const DTS = `
interface Base { id: number; describe(): string; }
interface Child extends Base { name: string; }
interface GrandChild extends Child { extra: boolean; }
interface Mixed extends Base, Other { }
interface Other { tag: string; }
declare function makeChild(): Child;
declare function makeGrand(): GrandChild;
declare function makeBase(): Base;
declare function makeMixed(): Mixed;
declare function takeBase(b: Base): void;
`;

const compile = (body, dts = DTS) =>
	compileDts(
		dts,
		`package main

import "js:./types.d.ts"

${body}
`,
	);

section(".d.ts — interface inheritance");

test("a derived interface reads members of its base", () => {
	const { errors } = compile(`func main() {
	c := makeChild()
	var id float64 = c.id
	var s string = c.describe()
	var n string = c.name
	println(id, s, n)
}`);
	assertEqual(errors.length, 0);
});

test("members are inherited over two levels", () => {
	const { errors } = compile(`func main() {
	g := makeGrand()
	var id float64 = g.id
	var n string = g.name
	var e bool = g.extra
	println(id, n, e, g.describe())
}`);
	assertEqual(errors.length, 0);
});

test("members are inherited from every base of a multi-extends", () => {
	const { errors } = compile(`func main() {
	m := makeMixed()
	println(m.id, m.tag)
}`);
	assertEqual(errors.length, 0);
});

test("an inherited member keeps its type", () => {
	const { errors } = compile(`func main() {
	c := makeChild()
	var s string = c.id
	println(s)
}`);
	assertErrorContains(errors, "cannot use c.id");
});

test("a member no interface in the chain has is rejected with its position", () => {
	const { errors } = compile(`func main() {
	g := makeGrand()
	println(g.missing)
}`);
	assertErrorContains(errors, "No member 'missing' in namespace GrandChild");
	assertContains(errors[0].message, "at line 7:");
});

test("a base's member is not visible on an unrelated interface", () => {
	const { errors } = compile(`func main() {
	o := makeMixed()
	var x Other = nil
	println(x.id, o.tag)
}`);
	assertErrorContains(errors, "No member 'id' in namespace Other");
});

test("an interface that extends one declared later still inherits", () => {
	const { errors } = compile(
		`func main() { println(mk().id) }`,
		`interface Late extends Early { }
interface Early { id: number; }
declare function mk(): Late;`,
	);
	assertEqual(errors.length, 0);
});

test("a class extending a class inherits its members", () => {
	const { errors } = compile(
		`func main() { println(mk().id) }`,
		`declare class A { id: number; }
declare class B extends A implements Other { n: number; }
interface Other { }
declare function mk(): B;`,
	);
	assertEqual(errors.length, 0);
});

test("a cyclic extends does not hang", () => {
	const { errors } = compile(
		`func main() { println(mk().nope) }`,
		`interface A extends B { }
interface B extends A { }
declare function mk(): A;`,
	);
	assertErrorContains(errors, "No member 'nope' in namespace A");
});

section(".d.ts — interface assignability");

test("a derived interface is assignable to its base", () => {
	const { errors } = compile(`func main() {
	var b Base = makeChild()
	takeBase(makeGrand())
	var c Child = makeGrand()
	println(b.id, c.name)
}`);
	assertEqual(errors.length, 0);
});

test("a base is not assignable to its derived interface", () => {
	const { errors } = compile(`func main() {
	var c Child = makeBase()
	println(c.name)
}`);
	assertErrorContains(errors, "cannot use makeBase()");
	assertErrorContains(errors, "as Child value");
});

test("an unrelated interface is not assignable", () => {
	const { errors } = compile(`func main() {
	var o Other = makeChild()
	println(o.tag)
}`);
	assertErrorContains(errors, "as Other value");
});

section(".d.ts — interface assertions");

test("b.(Child) on a resolved Base parameter passes the value through", () => {
	const { js, errors } = compile(`func f(b Base) {
	c := b.(Child)
	println(c.name)
}
func main() { f(makeChild()) }`);
	assertEqual(errors.length, 0);
	assert(!js.includes("instanceof"), "assertion emits no runtime check");
	assert(!js.includes("__tafail"), "assertion cannot panic");
});

test("a comma-ok assertion on a .d.ts interface is accepted", () => {
	const { errors } = compile(`func f(b Base) {
	if c, ok := b.(Child); ok {
		println(c.name)
	}
}
func main() { f(makeChild()) }`);
	assertEqual(errors.length, 0);
});

test("an assertion to a .d.ts interface from any passes through", () => {
	const { errors } = compile(`func f(v any) {
	c := v.(Child)
	println(c.name)
}
func main() { f(makeChild()) }`);
	assertEqual(errors.length, 0);
});

test("an assertion from a .d.ts interface to a Go type is still rejected", () => {
	const { errors } = compile(`func f(b Base) {
	_ = b.(int)
}
func main() { f(makeBase()) }`);
	assertErrorContains(
		errors,
		"invalid type assertion: Base is not an interface",
	);
});

test("an assertion on a GoFront package namespace is still rejected", () => {
	const { errors } = compileDts(
		DTS,
		`package main

import "fmt"
import "js:./types.d.ts"

func main() {
	_ = fmt.(int)
	takeBase(makeBase())
}
`,
	);
	assertErrorContains(errors, "use of package fmt not in selector");
});

test("a Go struct is not asserted from a .d.ts interface", () => {
	const { errors } = compile(`type S struct{}
func f(b Base) {
	_ = b.(S)
}
func main() { f(makeBase()) }`);
	assertErrorContains(
		errors,
		"invalid type assertion: Base is not an interface",
	);
});

section(".d.ts — locals named after browser globals");

test("a local variable named after a browser global with a .d.ts type is renamed", () => {
	const { js, errors } = compile(`func main() {
	document := makeChild()
	println(document.id)
}`);
	assertEqual(errors.length, 0);
	assert(
		js.includes("document$"),
		`expected the local to be renamed, got:\n${js}`,
	);
	assert(!/\bconst document = /.test(js), "the local shadows the real global");
});

test("a .d.ts declared global of that name is not renamed", () => {
	const { js, errors } = compile(
		`func main() { println(document.id) }`,
		`${DTS}
declare var document: Child;`,
	);
	assertEqual(errors.length, 0);
	assert(!js.includes("document$"), "a declared JS global keeps its name");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
