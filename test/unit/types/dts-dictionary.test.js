// GoFront test suite — `.d.ts` dictionary arguments
//
// An interface declared after a `@dictionary` comment is an options object: a
// parameter of its type takes `nil`, a `map[string]any` literal whose constant
// keys are members and a struct whose fields are members.

import { fileURLToPath } from "node:url";
import {
	assert,
	assertEqual,
	assertErrorContains,
	compileDts,
	parseDts,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

const DTS = `
/** @dictionary */
interface Base { label?: string; }

/** @dictionary */
interface Layout { bindings: number; }

/** @dictionary */
export interface Desc extends Base {
	size: number;
	count?: int;
	layout?: Layout;
	flag?: boolean;
}

interface Plain { size: number; }

declare function create(d: Desc): number;
declare function createOpt(d?: Desc): number;
declare function plain(p: Plain): void;
`;

const compile = (body, dts = DTS) =>
	compileDts(
		dts,
		`package main

import "js:./types.d.ts"

${body}
`,
	);

section(".d.ts — dictionary marker");

test("a @dictionary comment marks the interface that follows", () => {
	const { types } = parseDts(DTS);
	assertEqual(types.get("Desc")._dictionary, true);
	assertEqual(types.get("Base")._dictionary, true);
	assertEqual(types.get("Layout")._dictionary, true);
	assertEqual(types.get("Plain")._dictionary, undefined);
});

test("a // comment marks too, and the mark does not reach the next declaration", () => {
	const { types } = parseDts(`// @dictionary
interface A { x: number; }
interface B { y: number; }
/* @dictionary */ interface C { z: number; }`);
	assertEqual(types.get("A")._dictionary, true);
	assertEqual(types.get("B")._dictionary, undefined);
	assertEqual(types.get("C")._dictionary, true);
});

test("a dictionary inside a namespace is marked", () => {
	const { types } = parseDts(`declare namespace N {
	/** @dictionary */
	interface D { x: number; }
	interface E { y: number; }
}`);
	const members = types.get("N").members;
	assertEqual(members.D._dictionary, true);
	assertEqual(members.E._dictionary, undefined);
});

section(".d.ts — parenthesised types");

// The type of the parameter `x` of `declare function f(x: <type>): void`.
const paramOf = (type) => {
	const { values } = parseDts(`declare function f(x: ${type}): void;`);
	return values.get("f").params[0];
};

test("a parenthesised union of a type and null keeps the type", () => {
	const t = paramOf("(Foo | null)[]");
	assertEqual(t.kind, "slice");
	assertEqual(t.elem.alias, "Foo");
	assertEqual(t.elem._nullable, true);
});

test("a nested parenthesis still keeps the type", () => {
	const t = paramOf("((Foo | null))[]");
	assertEqual(t.kind, "slice");
	assertEqual(t.elem.alias, "Foo");
	assertEqual(t.elem._nullable, true);
});

test("a parenthesised primitive union keeps its first member", () => {
	const t = paramOf("(string | null)[]");
	assertEqual(t.kind, "slice");
	assertEqual(t.elem.name, "string");
	assertEqual(t.elem._nullable, true);
	assertEqual(paramOf("(string | number)[]").elem.name, "string");
});

test("a parenthesised type name is that type", () => {
	assertEqual(paramOf("(Foo)").alias, "Foo");
	assertEqual(paramOf("(string)").name, "string");
});

test("a parenthesised function type is still a function", () => {
	const t = paramOf("((x: number) => void)[]");
	assertEqual(t.kind, "slice");
	assertEqual(t.elem.kind, "func");
	const nullable = paramOf("(() => void) | null");
	assertEqual(nullable.kind, "func");
	assertEqual(nullable._nullable, true);
});

section(".d.ts — dictionary arguments");

test("a dictionary parameter takes nil", () => {
	const { errors } = compile(`func main() {
	create(nil)
	createOpt(nil)
	createOpt()
}`);
	assertEqual(errors.length, 0);
});

test("a map[string]any literal with member keys is accepted", () => {
	const { js, errors } = compile(`func main() {
	println(create(map[string]any{"size": 16, "label": "buf", "flag": true}))
}`);
	assertEqual(errors.length, 0);
	assert(
		js.includes('{ "size": 16, "label": "buf", "flag": true }'),
		`the literal reaches JS as a plain object:\n${js}`,
	);
});

test("an empty literal is accepted", () => {
	const { errors } = compile(`func main() { create(map[string]any{}) }`);
	assertEqual(errors.length, 0);
});

test("a nested dictionary literal is checked recursively", () => {
	const { errors } = compile(`func main() {
	create(map[string]any{
		"size":   1,
		"layout": map[string]any{"bindings": 2},
	})
}`);
	assertEqual(errors.length, 0);
});

test("a nested dictionary literal with an unknown key is rejected", () => {
	const { errors } = compile(`func main() {
	create(map[string]any{
		"size":   1,
		"layout": map[string]any{"bindingz": 2},
	})
}`);
	assertErrorContains(errors, "unknown member 'bindingz' in dictionary Layout");
});

test("a nested dictionary takes nil", () => {
	const { errors } = compile(`func main() {
	create(map[string]any{"size": 1, "layout": nil})
}`);
	assertEqual(errors.length, 0);
});

test("a dictionary literal is accepted in a declaration", () => {
	const { errors } = compile(`func main() {
	var d Desc = map[string]any{"size": 1}
	create(d)
}`);
	assertEqual(errors.length, 0);
});

test("an unknown literal key is an error naming it", () => {
	const { errors } = compile(`func main() {
	create(map[string]any{"size": 1, "colour": "red"})
}`);
	assertErrorContains(errors, "unknown member 'colour' in dictionary Desc");
	assertEqual(errors.length, 1);
});

test("a key is a member of the interface it extends", () => {
	const { errors } = compile(`func main() {
	create(map[string]any{"size": 1, "label": "x"})
}`);
	assertEqual(errors.length, 0);
});

test("a non-constant key is rejected", () => {
	const { errors } = compile(`func main() {
	k := "size"
	create(map[string]any{k: 1})
}`);
	assertErrorContains(errors, "dictionary key must be a constant string");
});

test("a wrong member type is rejected", () => {
	const { errors } = compile(`func main() {
	create(map[string]any{"size": "big"})
}`);
	assertErrorContains(
		errors,
		"as float64 value in member size of dictionary Desc",
	);
});

test("a wrong nested member type is rejected", () => {
	const { errors } = compile(`func main() {
	create(map[string]any{"size": 1, "layout": map[string]any{"bindings": "two"}})
}`);
	assertErrorContains(errors, "in member bindings of dictionary Layout");
});

test("a member of integer type keeps the strict numeric rules", () => {
	const { errors } = compile(`func main() {
	f := 1.5
	create(map[string]any{"size": 1, "count": f})
}`);
	assertErrorContains(errors, "as int value in member count");
});

test("a map variable (no constant keys) is not a dictionary", () => {
	const { errors } = compile(`func main() {
	m := map[string]any{"size": 1}
	create(m)
}`);
	assertErrorContains(errors, "as Desc value in argument to create");
});

test("a field-only struct whose fields are members is accepted", () => {
	const { errors } = compile(`type D struct {
	size  float64
	label string
	count int
}

func main() {
	d := D{size: 2, label: "x"}
	create(d)
	create(D{size: 3})
}`);
	assertEqual(errors.length, 0);
});

test("a struct field that is not a member is an error naming it", () => {
	const { errors } = compile(`type D struct {
	size   float64
	colour string
}

func main() {
	create(D{size: 2})
}`);
	assertErrorContains(errors, "unknown field 'colour' in dictionary Desc");
});

test("a struct field of the wrong type is rejected", () => {
	const { errors } = compile(`type D struct {
	size string
}

func main() {
	create(D{size: "x"})
}`);
	assertErrorContains(
		errors,
		"cannot use field 'size' (type string) as float64 in dictionary Desc",
	);
});

test("a struct with methods is not a dictionary", () => {
	const { errors } = compile(`type D struct {
	size float64
}

func (d D) Area() float64 { return d.size }

func main() {
	create(D{size: 1})
}`);
	assertErrorContains(errors, "as Desc value in argument to create");
});

test("a pointer to a struct is not a dictionary", () => {
	const { errors } = compile(`type D struct {
	size float64
}

func main() {
	create(&D{size: 1})
}`);
	assertErrorContains(errors, "as Desc value in argument to create");
});

test("an unmarked interface behaves as today", () => {
	const { errors } = compile(`func main() {
	plain(map[string]any{"size": 1})
}`);
	assertErrorContains(errors, "as Plain value in argument to plain");
});

test("an unmarked interface rejects a struct and takes nil", () => {
	const { errors } = compile(`type P struct {
	size float64
}

func main() {
	plain(nil)
	plain(P{size: 1})
}`);
	assertErrorContains(errors, "as Plain value in argument to plain");
	assertEqual(errors.length, 1);
});

test("a dictionary literal runs as a plain object", () => {
	const { js, errors } = compile(`func main() {
	println(create(map[string]any{"size": 4, "label": "b"}))
}`);
	assertEqual(errors.length, 0);
	const out = runJs(js, { create: (d) => d.size + d.label.length });
	assertEqual(out.trim(), "5");
});

section(".d.ts — a type is not a value");

test("a composite literal of a declared interface or dictionary is rejected", () => {
	const { errors } = compile(`func main() {
	_ = Plain{}
	_ = Desc{}
	_ = []Plain{{}}
}`);
	assertErrorContains(errors, "invalid composite literal type Plain");
	assertErrorContains(errors, "invalid composite literal type Desc");
	assertEqual(errors.length, 3);
});

test("a Go struct literal and a map-built dictionary still compile", () => {
	const { errors } = compile(`type S struct{ a int }

func main() {
	_ = S{a: 1}
	_ = []S{{a: 1}}
	println(create(map[string]any{"size": 1}))
}`);
	assertEqual(errors.map((e) => e.message).join(), "");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
