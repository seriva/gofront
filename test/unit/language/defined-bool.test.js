// GoFront test suite — comparison results are untyped bools

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	assertErrorContains,
	compile,
	compileWasm,
	section,
	summarize,
	test,
} from "../helpers.js";

section("Untyped bool: a comparison fits a defined bool type");

const PRELUDE = `package main

import "fmt"

type B bool
type S struct{ v B }

func f(b B) { fmt.Println(b) }
`;

for (const [name, body, want] of [
	["plain call f(x == 1)", "x := 1\n\tf(x == 1)", "true\n"],
	[
		"var b B = x == 1",
		"x := 1\n\tvar b B = x == 1\n\tfmt.Println(b)",
		"true\n",
	],
	[
		"assignment b = x < 2",
		"x := 1\n\tvar b B\n\tb = x < 2\n\tfmt.Println(b)",
		"true\n",
	],
	["struct field S{x == 1}", "x := 1\n\tfmt.Println(S{x == 1}.v)", "true\n"],
	[
		"map value",
		'x := 1\n\tfmt.Println(map[string]B{"a": x == 1}["a"])',
		"true\n",
	],
	["&& of comparisons", "x, y := 1, 2\n\tf(x == 1 && y == 2)", "true\n"],
	["|| and ! of comparisons", "x := 1\n\tf(!(x == 2) || x == 3)", "true\n"],
	[
		"typed B operand with a comparison",
		"x := 1\n\tvar b B = true\n\tf(b && x == 1)",
		"true\n",
	],
	[
		"default type bool for := and any",
		'x := 1\n\tu := x == 1\n\tvar a any = x == 1\n\tfmt.Printf("%T %T\\n", u, a)',
		"bool bool\n",
	],
	[
		"if and for conditions",
		'x := 1\n\tif x == 1 {\n\t\tfmt.Println("y")\n\t}\n\tfor i := 0; i < 1 && x == 1; i++ {\n\t\tfmt.Println("z")\n\t}',
		"y\nz\n",
	],
]) {
	test(`${name} (js, both, wasm)`, async () => {
		await assertAllTargetsOutput(
			`${PRELUDE}\nfunc main() {\n\t${body}\n}\n`,
			want,
		);
	});
}

test("return x == 1 into a defined bool result", async () => {
	await assertAllTargetsOutput(
		`${PRELUDE}
func g(x int) B { return x == 1 }

func main() {
	f(g(1))
}
`,
		"true\n",
	);
});

test("variadic ...B accepts comparisons", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type B bool

func f(bs ...B) { fmt.Println(len(bs), bs[0], bs[1]) }

func main() {
	x := 1
	f(x == 1, x == 2)
}
`,
		"2 true false\n",
	);
});

section("Defined bool: && and || keep the operand type");

const LOGIC_PRELUDE = `package main

import "fmt"

type B bool

func f(b B) { fmt.Println(b) }
`;

for (const [name, body, want] of [
	[
		"var b3 B = b1 && b2",
		"var b1, b2 B = true, false\n\tvar b3 B = b1 && b2\n\tfmt.Println(b3)",
		"false\n",
	],
	[
		"var b3 B = b1 || b2",
		"var b1, b2 B = true, false\n\tvar b3 B = b1 || b2\n\tfmt.Println(b3)",
		"true\n",
	],
	[
		"call argument f(b1 && b2)",
		"var b1, b2 B = true, true\n\tf(b1 && b2)",
		"true\n",
	],
	[
		"c := b1 && b2 has type B",
		'var b1, b2 B = true, true\n\tc := b1 && b2\n\tfmt.Printf("%T\\n", c)',
		"main.B\n",
	],
]) {
	test(`${name} (js, both, wasm)`, async () => {
		await assertAllTargetsOutput(
			`${LOGIC_PRELUDE}\nfunc main() {\n\t${body}\n}\n`,
			want,
		);
	});
}

test("return b1 && b2 into a defined bool result", async () => {
	await assertAllTargetsOutput(
		`${LOGIC_PRELUDE}
func g(a, b B) B { return a && b }

func main() {
	f(g(true, false))
}
`,
		"false\n",
	);
});

function errorsOn(target, src) {
	if (target === "wasm") return compileWasm(src).errors ?? [];
	return compile(src, { target }).errors ?? [];
}

section("Untyped bool: typed bools and other defined types stay errors");

for (const [name, body] of [
	["a typed bool variable", "x := true\n\tvar b B = x\n\t_ = b"],
	["!x of a typed bool", "x := true\n\tvar b B = !x\n\t_ = b"],
	["a && b of typed bools", "x, y := true, false\n\tvar b B = x && y\n\t_ = b"],
	[
		"a comparison into a defined int type",
		"x := 1\n\tvar i MyI = x == 1\n\t_ = i",
	],
]) {
	for (const target of ["js", "both", "wasm"]) {
		test(`${name} is rejected (${target})`, () => {
			assertErrorContains(
				errorsOn(
					target,
					`package main\n\ntype B bool\ntype MyI int\n\nfunc main() {\n\t${body}\n}\n`,
				),
				"Cannot assign",
			);
		});
	}
}

section("Defined bool: mixing bool types in && and || is rejected");

for (const [name, body, want] of [
	[
		"a && b of defined bools into a bool",
		"var b1, b2 B = true, false\n\tvar c bool = b1 && b2\n\t_ = c",
		"Cannot assign",
	],
	[
		"B && bool variable",
		"var b1 B = true\n\tc := true\n\t_ = b1 && c",
		"mismatched types",
	],
	[
		"bool || B variable",
		"var b1 B = true\n\tc := true\n\t_ = c || b1",
		"mismatched types",
	],
]) {
	for (const target of ["js", "both", "wasm"]) {
		test(`${name} is rejected (${target})`, () => {
			assertErrorContains(
				errorsOn(
					target,
					`package main\n\ntype B bool\n\nfunc main() {\n\t${body}\n}\n`,
				),
				want,
			);
		});
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
