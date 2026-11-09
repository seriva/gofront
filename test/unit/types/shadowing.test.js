// test/unit/types/shadowing.test.js
// Task 0.9: browser globals and other predeclared names live in a universe
// scope below the package scope, so package and local declarations shadow
// them as in Go, in every target.

import {
	assert,
	assertEqual,
	assertErrorContains,
	assertProgramOutput,
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

section("Type declarations named after browser globals (Task 0.19d)");

test("js package: type Array struct{} is rejected", () => {
	const { errors } = compile(
		"package main\n\ntype Array struct{ N int }\n\nfunc main() { _ = Array{} }\n",
		{ target: "js" },
	);
	assertErrorContains(
		errors,
		"type Array shadows the JavaScript global Array; rename the type",
	);
});

test("both package: type Error struct{} is rejected", () => {
	const { errors } = compile(
		"//gofront:target both\npackage main\n\ntype Error struct{ Msg string }\n\nfunc Main() int { return len(Error{}.Msg) }\n",
	);
	assertErrorContains(
		errors,
		"type Error shadows the JavaScript global Error; rename the type",
	);
});

test("wasm package: type Array struct{} compiles (no JS class is emitted)", () => {
	const { wasm, errors } = compileWasm(`
package main

type Array struct{ N int }

func Main() int { return Array{N: 3}.N }
`);
	assertEqual(errors.length, 0);
	assertEqual(runWasm(wasm).exports.Main(), 3n);
});

test("type alias named after a browser global is allowed", () => {
	const { errors } = compile(
		"package main\n\ntype Object = map[string]int\n\nfunc main() { _ = Object{} }\n",
		{ target: "js" },
	);
	assertEqual(errors.length, 0);
});

test("named type with methods named after a JS built-in is rejected", () => {
	const { errors } = compile(
		'package main\n\ntype Set map[string]bool\n\nfunc (s Set) Has(k string) bool { return s[k] }\n\nfunc main() { _ = Set{}.Has("a") }\n',
		{ target: "js" },
	);
	assertErrorContains(
		errors,
		"type Set shadows the JavaScript global Set; rename the type",
	);
});

test("interfaces, method-less named types and DOM names are allowed", () => {
	const { js, errors } = compile(
		'package main\n\ntype Number interface{ ~int | ~float64 }\n\ntype Error interface{ Error() string }\n\ntype String string\n\ntype Element struct{ Tag string }\n\nfunc Twice[T Number](x T) T { return x + x }\n\nfunc main() { println(Twice(2), String("s"), Element{Tag: "p"}.Tag) }\n',
		{ target: "js" },
	);
	assertEqual(errors.map((e) => e.message).join("\n"), "");
	assert(js.includes("class Element"), "Element struct emitted");
});

section("Declarations that read the name they shadow");

test("comma-ok map lookup, switch init, for init and case body read the outer name", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func f(x int) int { return x * 3 }

func main() {
	m := map[int]int{4: 7}
	k := 4
	{
		k, ok := m[k]
		fmt.Println(k, ok)
	}
	x := 1
	switch x := x + 1; x {
	case 1:
		fmt.Println("one")
	case 2:
		fmt.Println("two")
	}
	n := 2
	for n := n; n < 4; n++ {
		fmt.Println("n", n)
	}
	switch y := 5; y {
	case 5:
		x := f(x)
		fmt.Println(x)
	}
}
`,
		"7 true\ntwo\nn 2\nn 3\n3\n",
	);
});

section("Comma-ok := that reuses a name");

test("type assertion comma-ok with a reused name", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type L struct{}
type N int
type T struct{}

func main() {
	var a, b any = 1, N(0)
	_, ok2 := a.(L)
	n, ok2 := b.(N)
	fmt.Println(n, ok2)
	var x any = 1
	var y any = &T{}
	p, ok := x.(int)
	q, ok := y.(*T)
	fmt.Println(p, ok, q != nil)
	var z any = "s"
	r, ok := z.(int)
	fmt.Println(r, ok)
}
`,
		"0 true\n1 true true\n0 false\n",
	);
});

test("map comma-ok with a reused ok", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	m := map[string]int{"a": 1}
	_, ok := m["z"]
	v, ok := m["a"]
	fmt.Println(v, ok)
}
`,
		"1 true\n",
	);
});

test("a labeled for whose init reads the outer name still continues the label", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	n := 1
outer:
	for n := n + 1; n < 5; n++ {
		for j := 0; j < 2; j++ {
			if j == 1 {
				continue outer
			}
			fmt.Println(n, j)
		}
	}
	fmt.Println(n)
}
`,
		"2 0\n3 0\n4 0\n1\n",
	);
});

section("Function-local types sharing a name");

test("same-named local types in two functions keep their own layout", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func a() { type Dup struct{ X int }; fmt.Println(Dup{1}) }
func b() { type Dup struct{ Y string }; fmt.Println(Dup{"y"}) }

func main() {
	a()
	b()
	type Dup struct{ Z bool }
	fmt.Printf("%T\\n", Dup{})
}
`,
		"{1}\n{y}\nmain.Dup\n",
	);
});

test("a local type shadows a package-level type of the same name", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type T struct{ A int }

func main() {
	type T struct{ B string }
	fmt.Println(T{"x"})
}
`,
		"{x}\n",
	);
});
