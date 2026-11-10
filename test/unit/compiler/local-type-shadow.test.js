// test/unit/compiler/local-type-shadow.test.js
// A function-local type named like an imported package's type must not
// rewrite the imported type.

import {
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
