// test/unit/types/shadowing.test.js
// Task 0.9: browser globals and other predeclared names live in a universe
// scope below the package scope, so package and local declarations shadow
// them as in Go, in every target.

import {
	assert,
	assertEqual,
	assertErrorContains,
	compile,
	compileHybrid,
	compileHybridProject,
	compileWasm,
	runWasm,
	section,
	test,
} from "../helpers.js";

section("Predeclared-name shadowing");

const SHADOW_SRC = `
func Array() int { return 40 }

var document int = 2

func Main() int {
	len := 3
	return Array() + document*len - 6
}
`;

function noRedeclared(errors) {
	const msgs = (errors ?? []).map((e) => e.message).join("\n");
	assert(!msgs.includes("redeclared"), `unexpected redeclaration:\n${msgs}`);
	assertEqual(msgs, "");
}

test("js package: func Array, var document and local len shadow predeclared names", () => {
	const src = `package main\n${SHADOW_SRC}`;
	const { js, errors } = compile(src, { target: "js" });
	noRedeclared(errors);
	assert(
		js.includes("function Array$("),
		"package func Array is emitted as Array$",
	);
});

test("wasm package: shadowing compiles and runs", () => {
	const src = `//gofront:target wasm\npackage main\n${SHADOW_SRC}`;
	const { wasm, stringTable, errors } = compileWasm(src);
	noRedeclared(errors);
	const { exports } = runWasm(wasm, { stringTable });
	assertEqual(exports.Main(), 40n);
});

test("both package: shadowing gives the same result on both backends", () => {
	const res = compileHybrid(`package main\n${SHADOW_SRC}`).run("Main");
	assertEqual(res.jsRes, 40);
});

test("shadowed global is used in place of the browser global", () => {
	const src = `package main

var console int = 7

func Main() int { return console + 1 }
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.jsRes, 8);
});

test("redeclaring a package-level name is still an error", () => {
	const src = `package main
func Array() int { return 1 }
func Array() int { return 2 }
`;
	const { errors } = compile(src);
	assertErrorContains(errors, "Array redeclared in this block");
});

test("generated JS keeps reaching the real globals a package shadows", () => {
	const src = `package main

import "strings"

func Array() int { return 40 }

var Object = 1

func Main() int {
	n := 0
	for _, r := range "héllo" {
		n += int(r) % 2
	}
	m := map[string]int{"ab": 1}
	for k := range m {
		n += len(k)
	}
	return Array() + n + len(strings.Split("a,b", ",")) + Object
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.jsRes, 47);
});

for (const target of ["both", "wasm"]) {
	test(`importing a ${target} package that shadows browser globals`, async () => {
		const { mod } = await compileHybridProject(
			{
				"util/u.go": `//gofront:target ${target}
package util

func Array() int { return 40 }

const Object = 2
`,
				"main.go": `package main

import "./util"

func Main() int {
	n := 0
	for _, r := range "ab" {
		n += int(r)
	}
	return util.Array() + util.Object + n
}
`,
			},
			{ exports: ["Main"] },
		);
		assertEqual(mod.Main(), 237);
	});
}

for (const target of ["js", "wasm"]) {
	test(`dot-importing a ${target} package that shadows browser globals`, async () => {
		const { mod } = await compileHybridProject(
			{
				"util/u.go": `//gofront:target ${target}
package util

func Array() int { return 7 }
`,
				"main.go": `package main

import . "./util"

func Main() int { return Array() }
`,
			},
			{ exports: ["Main"] },
		);
		assertEqual(mod.Main(), 7);
	});
}

test("an import alias named after a browser global keeps reaching the package", async () => {
	const { mod } = await compileHybridProject(
		{
			"util/u.go": `//gofront:target both
package util

func Answer() int { return 42 }
`,
			"main.go": `package main

import console "./util"

func Main() int { return console.Answer() }
`,
		},
		{ exports: ["Main"] },
	);
	assertEqual(mod.Main(), 42);
});

test("a package directory named after a browser global keeps reaching the package", async () => {
	const { mod } = await compileHybridProject(
		{
			"document/d.go": `//gofront:target both
package document

func Answer() int { return 42 }
`,
			"main.go": `package main

import "./document"

func Main() int { return document.Answer() }
`,
		},
		{ exports: ["Main"] },
	);
	assertEqual(mod.Main(), 42);
});

test("a := redeclaration of a browser-global name assigns the local", () => {
	const src = `package main

func Main() int {
	document := 1
	x, document := 2, 3
	return x + document
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.jsRes, 5);
});
