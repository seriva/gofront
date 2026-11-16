// test/unit/compiler/local-type-shadow.test.js
// A function-local type named like an imported package's type must not
// rewrite the imported type.

import {
	assertAllTargetsOutput,
	assertEqual,
	compileHybridProject,
	section,
	test,
} from "../helpers.js";

section("Local types vs imported package types");

const A_SRC = (target) => `//gofront:target ${target}
package a

type Pt struct{ X int }
`;

const MAIN_SRC = `package main

import "./lib"

func Main() string { return lib.Run() }
`;

const CASES = [
	[
		"local Pt does not rewrite a.Pt",
		`	type Pt struct{ Z bool }
	_ = Pt{true}
	return fmt.Sprint(a.Pt{1})`,
		"{1}",
	],
	[
		"local Pt and a.Pt print side by side",
		`	type Pt struct{ Z bool }
	return fmt.Sprint(Pt{true}, a.Pt{1})`,
		"{true} {1}",
	],
];

for (const [name, body, want] of CASES) {
	for (const target of ["js", "both", "wasm"]) {
		test(`${name} (lib target ${target})`, async () => {
			const { mod } = await compileHybridProject(
				{
					"a/a.go": A_SRC(target),
					"lib/lib.go": `//gofront:target ${target}
package lib

import (
	"fmt"
	"../a"
)

func Run() string {
${body}
}
`,
					"main.go": MAIN_SRC,
				},
				{ exports: ["Main"] },
			);
			assertEqual(mod.Main(), want);
		});
	}
}

section("Function-local types named after JS built-ins");

test("local types named Map and BigInt compile and run", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type K struct{ A, B int }

func main() {
	type Map struct{ N int }
	type BigInt struct{ N int }
	seen := map[K]bool{{1, 2}: true}
	var x int64 = 1 << 40
	fmt.Println(Map{1}.N, BigInt{2}.N, len(seen), x*3)
}
`,
		"1 2 1 3298534883328\n",
	);
});

test("%T of a local type named after a JS built-in drops the rename", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	type Map struct{}
	fmt.Printf("%T\\n", Map{})
}
`,
		"main.Map\n",
	);
});

test("a local type named Set next to a local value Set", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	type Set struct{ N int }
	s := Set{4}
	fmt.Println(s.N)
	Set := 7
	fmt.Println(Set)
}
`,
		"4\n7\n",
	);
});

test("a local type named Map inside a generic function", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func wrap[T any](v T) any {
	type Map struct{ N int }
	_ = v
	return Map{3}
}

func main() {
	fmt.Printf("%v %T\\n", wrap(1), wrap("x"))
}
`,
		"{3} main.Map\n",
	);
});
