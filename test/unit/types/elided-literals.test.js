// GoFront test suite — elided composite literals under pointers and type parameters
//
// `[]*T{{...}}` stands for `[]*T{&T{...}}` and `[]X{{...}}` for a type
// parameter `X` with a core type builds that core type, so the elements of
// the elided literal are checked like those of a literal that names its type.

import { fileURLToPath } from "node:url";
import {
	assertEqual,
	assertErrorContains,
	assertJsProgramOutput,
	compile,
	section,
	summarize,
	test,
} from "../helpers.js";

const check = (decls, body) =>
	compile(`package main

type T struct{ a int }
${decls}

func main() {
	${body}
}
`).errors;

section("Elided literals: nested literals under a pointer or type parameter");

for (const [name, decls, body] of [
	["a pointer to a slice of slices", "", "_ = []*[][]int{{{1}}}"],
	["a pointer to a slice of structs", "", "_ = []*[]T{{{a: 1}}}"],
	["a pointer to a map of slices", "", '_ = []*map[string][]int{{"a": {1}}}'],
	[
		"a map value pointer to a slice of slices",
		"",
		'_ = map[string]*[][]int{"a": {{1}}}',
	],
	[
		"a type parameter with a slice of slices core",
		"func g[X ~[][]int]() { _ = []X{{{1}}} }",
		"",
	],
	["a pointer to a struct", "", "_ = []*T{{a: 1}}"],
	["a pointer to a slice", "", "_ = []*[]int{{1}}"],
	["a defined pointer type", "type P *T", "_ = []P{{}}"],
	["a pointer to an array", "", "_ = []*[2]int{{1}}"],
	[
		"an inferred-length array of structs with an index",
		"",
		"_ = [...]T{5: {a: 1}}",
	],
	["a map value pointer to a struct", "", '_ = map[string]*T{"k": {a: 1}}'],
	["a map key pointer to a struct", "", "_ = map[*T]int{{a: 1}: 1}"],
]) {
	test(`${name} compiles`, () => {
		assertEqual(
			check(decls, body)
				.map((e) => e.message)
				.join("\n"),
			"",
		);
	});
}

section(
	"Elided literals: elements are checked under a pointer or type parameter",
);

for (const [name, decls, body, want] of [
	[
		"a field of the wrong type",
		"",
		'_ = []*T{{a: "x"}}',
		"as int value in struct literal",
	],
	["an unknown field", "", "_ = []*T{{unknown: 1}}", "Unknown field 'unknown'"],
	[
		"too many positional values",
		"",
		"_ = []*T{{1, 2}}",
		"too many values in struct literal",
	],
	[
		"too few positional values",
		"",
		"_ = []*struct{ a, b int }{{1}}",
		"too few values in struct literal",
	],
	[
		"a slice element of the wrong type",
		"",
		'_ = []*[]int{{"bad"}}',
		"as int value in array or slice literal",
	],
	[
		"an array index out of bounds",
		"",
		"_ = []*[2]int{{5: 1}}",
		"array index 5 out of bounds [0:2]",
	],
	[
		"a map key of the wrong type",
		"",
		"_ = []*map[string]int{{123: 1}}",
		"as string value in map literal",
	],
	[
		"a map value of the wrong type",
		"",
		'_ = []*map[string]int{{"a": "b"}}',
		"as int value in map literal",
	],
	[
		"a map key pointer to a struct with a bad field",
		"",
		'_ = map[*T]int{{a: "x"}: 1}',
		"as int value in struct literal",
	],
	[
		"a map value pointer to a struct with a bad field",
		"",
		'_ = map[string]*T{"k": {a: "x"}}',
		"as int value in struct literal",
	],
	[
		"a nested element of the wrong type",
		"",
		'_ = []*[][]int{{{"bad"}}}',
		"as int value in array or slice literal",
	],
	[
		"a type parameter slice element",
		'func g[X ~[]int]() { _ = []X{{"bad"}} }',
		"",
		"as int value in array or slice literal",
	],
	[
		"a type parameter struct field",
		'func g[X ~struct{ a int }]() { _ = []X{{a: "bad"}} }',
		"",
		"as int value in struct literal",
	],
	[
		"a type parameter nested element",
		'func g[X ~[][]int]() { _ = []X{{{"bad"}}} }',
		"",
		"as int value in array or slice literal",
	],
	[
		"a typed type parameter literal",
		'func g[X ~[]int]() { _ = X{"bad"} }',
		"",
		"as int value in array or slice literal",
	],
]) {
	test(`${name} is rejected`, () => {
		assertErrorContains(check(decls, body), want);
	});
}

section("Elided literals: pointer elements still build their pointee");

test("elided struct pointers keep their identity and fields", async () => {
	await assertJsProgramOutput(
		`package main

type T struct{ a int }

func main() {
	xs := []*T{{a: 1}, {2}}
	xs[0].a++
	m := map[string]*T{"k": {a: 3}}
	m["k"].a += 4
	println(xs[0].a, xs[1].a, m["k"].a)
}
`,
		"2 2 7\n",
	);
});

test("nested elided literals under a type parameter build every level", async () => {
	await assertJsProgramOutput(
		`package main

func g[X ~[][]int]() int {
	xs := []X{{{1}, {2, 3}}}
	return xs[0][1][1]
}

func main() {
	println(g[[][]int]())
}
`,
		"3\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
