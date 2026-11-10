// GoFront test suite — function-local types that share a name with a local value

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	section,
	summarize,
	test,
} from "../helpers.js";

section("Local types — name shared with a local value");

test("a local value named like a local type is its own variable", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func a() {
	type Dup struct{ X int }
	Dup := 1
	fmt.Println(Dup)
}

func main() { a() }
`,
		"1\n",
	);
});

test("%T of a local type value keeps the Go name", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func a() {
	type Dup struct{ X int }
	d := Dup{}
	fmt.Println(fmt.Sprintf("%T", d))
	Dup := 1
	fmt.Println(Dup)
}

func b() {
	type Dup struct{ X int }
	fmt.Println(fmt.Sprintf("%T", Dup{}))
}

func main() { a(); b() }
`,
		"main.Dup\n1\nmain.Dup\n",
	);
});

test("value declared before the local type keeps both meanings", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func a() {
	Dup := 1
	fmt.Println(Dup)
	{
		type Dup struct{ X int }
		fmt.Println(fmt.Sprintf("%T", Dup{}))
	}
}

func main() { a() }
`,
		"1\nmain.Dup\n",
	);
});

test("a local value can be initialised from the type it shadows", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	type Dup struct{ X int }
	Dup := Dup{X: 42}
	fmt.Println(Dup.X)
}
`,
		"42\n",
	);
});

test("new of the shadowed local type in the shadowing declaration", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	type Dup struct{ X int }
	Dup := new(Dup)
	fmt.Println(Dup.X)
}
`,
		"0\n",
	);
});

test("conversion to the shadowed local type in the shadowing declaration", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	type Dup int
	Dup := Dup(42)
	fmt.Println(Dup)
}
`,
		"42\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
