// GoFront test suite — type-set elements next to methods in interfaces

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	assertProgramOutput,
	Lexer,
	Parser,
	section,
	summarize,
	test,
} from "../helpers.js";

function parse(source) {
	const tokens = new Lexer(source, "t.go").tokenize();
	return new Parser(tokens, "t.go", source).parse();
}

section("Parser — type-set elements with methods");

test("one-line interface with *T and a method parses", () => {
	parse(`package main
type Incer[T any] interface{ *T; Inc() }
`);
});

test("multi-line interface with *T and a method parses", () => {
	parse(`package main
type Incer[T any] interface {
	*T
	Inc()
}
`);
});

test("pointer-method constraint instantiates on both backends", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type Incer[T any] interface {
	*T
	Inc()
}

type C struct{ n int }

func (c *C) Inc() { c.n++ }

func bump[T any, P Incer[T]]() T {
	var v T
	P(&v).Inc()
	P(&v).Inc()
	return v
}

func main() {
	fmt.Println(bump[C]().n)
}
`,
		"2\n",
	);
});

section("Interface literal conversions");

test("interface{ M() }(T{}) converts and calls M", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T struct{}

func (T) M() { fmt.Println("m") }

func main() {
	v := interface{ M() }(T{})
	v.M()
}
`,
		"m\n",
	);
});

test("interface{}(3) prints 3", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	fmt.Println(interface{}(3))
}
`,
		"3\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
