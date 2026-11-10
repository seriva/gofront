// GoFront test suite — WASM unhashable map key panics name the dynamic type

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	assertWasmProgramOutput,
	section,
	summarize,
	test,
} from "../helpers.js";

section("WASM unhashable map keys");

const keyPanic = (decls, key) => `package main

import "fmt"

${decls}

func try(k any) {
	defer func() { fmt.Println(recover()) }()
	m := map[any]int{}
	m[k] = 1
	fmt.Println("no panic")
}

func main() {
	try(${key})
}
`;

test("a func key names func()", async () => {
	await assertWasmProgramOutput(
		keyPanic("", "func() {}"),
		"runtime error: hash of unhashable type func()\n",
	);
});

test("a func key names its parameters and results", async () => {
	await assertWasmProgramOutput(
		keyPanic("", 'func(i int) (string, error) { return "", nil }'),
		"runtime error: hash of unhashable type func(int) (string, error)\n",
	);
});

test("a struct key with a slice field names the struct", async () => {
	await assertAllTargetsOutput(
		keyPanic("type S struct{ s []int }", "S{}"),
		"runtime error: hash of unhashable type main.S\n",
	);
});

test("a defined slice key names the defined type", async () => {
	await assertAllTargetsOutput(
		keyPanic("type L []int", "L{1}"),
		"runtime error: hash of unhashable type main.L\n",
	);
});

test("a defined map key names the defined type", async () => {
	await assertAllTargetsOutput(
		keyPanic("type M map[string]int", "M{}"),
		"runtime error: hash of unhashable type main.M\n",
	);
});

test("an unnamed map key names the map type", async () => {
	await assertAllTargetsOutput(
		keyPanic("type M map[string]int", "map[string]int{}"),
		"runtime error: hash of unhashable type map[string]int\n",
	);
});

test("a defined map in an interface keeps its type", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

type M map[string]int

func show(v any) {
	switch x := v.(type) {
	case map[string]int:
		fmt.Println("plain", len(x))
	case M:
		fmt.Println("M", len(x), x["a"])
	}
}

func main() {
	var v any = M{"a": 1}
	fmt.Printf("%v %T\\n", v, v)
	b, err := json.Marshal(v)
	fmt.Println(string(b), err)
	show(v)
	show(map[string]int{"b": 2})
	m := v.(M)
	m["c"] = 3
	fmt.Println(len(v.(M)))
	var n M
	var w any = n
	fmt.Println(w == nil, w.(M) == nil)
	fmt.Println(fmt.Sprintf("%p", v) == fmt.Sprintf("%p", m), fmt.Sprintf("%p", v) == fmt.Sprintf("%p", M{}))
}
`,
		'map[a:1] main.M\n{"a":1} <nil>\nM 1 1\nplain 1\n2\nfalse true\ntrue false\n',
	);
});

test("a hashable struct key still works", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S struct{ a int }

func main() {
	m := map[any]int{}
	m[S{1}] = 7
	fmt.Println(m[S{1}], len(m))
}
`,
		"7 1\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
