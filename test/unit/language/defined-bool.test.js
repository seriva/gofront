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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
