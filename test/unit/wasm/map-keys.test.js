// GoFront test suite — WASM unhashable map key panics name the dynamic type

import { fileURLToPath } from "node:url";
import { FunctionEmitter } from "../../../src/backend/wasm/emit.js";
import { CompileError, InternalCompilerError } from "../../../src/compiler.js";
import {
	assert,
	assertAllTargetsOutput,
	assertProgramOutput,
	assertWasmProgramOutput,
	compileWasm,
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

test("a defined slice literal used directly as a key panics", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type L []int

type M map[string]int

func try(f func()) {
	defer func() { fmt.Println(recover()) }()
	f()
}

func main() {
	m := map[any]int{}
	try(func() { m[L{1}] = 1 })
	try(func() { m[M{}] = 1 })
	var l L
	try(func() { m[l] = 1 })
	try(func() { m[[2]int{1, 2}] = 1 })
	try(func() { m["s"] = 2 })
	fmt.Println(len(m), m["s"])
}
`,
		"runtime error: hash of unhashable type main.L\nruntime error: hash of unhashable type main.M\nruntime error: hash of unhashable type main.L\n<nil>\n<nil>\n2 2\n",
	);
});

test("array keys of a map[any] are found again by value", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	m := map[any]int{}
	m[[2]int{1, 2}] = 1
	fmt.Println(len(m), m[[2]int{1, 2}])
	a, b := 1, 2
	m[[2]int{a, b}]++
	k := [2]int{a, b}
	_, ok := m[[2]int{2, 1}]
	fmt.Println(len(m), m[k], ok)
	n := map[any]int{}
	n[[2]string{"a", "b"}] = 3
	n[[1]int{5}] = 2
	n[5] = 3
	fmt.Println(len(n), n[[1]int{5}], n[[2]string{"a", "b"}])
	delete(n, [1]int{5})
	fmt.Println(len(n), n[5])
}
`,
		"1 1\n1 2 false\n3 2 3\n2 3\n",
	);
});

test("many array keys of a map[any] hash by their elements", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type P struct{ X, Y int }

func main() {
	m := map[any]int{}
	for i := 0; i < 200; i++ {
		m[[2]int{i, i * 2}] = i
	}
	m[[1]P{{1, 2}}] = 7
	m[[2]float64{0, 1}] = 8
	m[[1]any{"x"}] = 9
	fmt.Println(len(m), m[[2]int{150, 300}], m[[1]P{{1, 2}}], m[[2]float64{0, 1}], m[[1]any{"x"}])
}
`,
		"203 150 7 8 9\n",
	);
});

section("WASM map keys the backend cannot hash are user errors");

test("an unsupported map key type is a CompileError, not an internal error", () => {
	const original = FunctionEmitter.prototype._unsupportedMapKey;
	FunctionEmitter.prototype._unsupportedMapKey = () =>
		"map key type 'chan' is not supported on wasm";
	let err = null;
	try {
		compileWasm(`package main

func main() {
	var x int
	m := map[*int]int{}
	m[&x] = 1
}
`);
	} catch (e) {
		err = e;
	} finally {
		FunctionEmitter.prototype._unsupportedMapKey = original;
	}
	assert(
		err instanceof CompileError && !(err instanceof InternalCompilerError),
		`expected a user CompileError, got ${err?.name}: ${err?.message}`,
	);
	assert(
		!err.message.includes("internal compiler error"),
		`message: ${err.message}`,
	);
	assert(
		err.message.includes("map key type 'chan' is not supported on wasm"),
		`message: ${err.message}`,
	);
});

section("WASM map keys — defined key chains");

test("defined array and struct key chains behave like Go", async () => {
	await assertAllTargetsOutput(
		`package main

type P struct{ X int }
type K [2]P
type K2 K

func main() {
	m := map[K2]string{}
	m[K2{{1}, {2}}] = "a"
	m[K2{{1}, {2}}] += "b"
	m[K2{{2}, {1}}] = "c"
	println(len(m), m[K2{{1}, {2}}], m[K2{{2}, {1}}])
}
`,
		"2 ab c\n",
	);
});

section("WASM anonymous struct map keys");

test("an anonymous struct with an array field is a map key", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	a := struct {
		X int
		S string
		A [2]int
	}{1, "s", [2]int{3, 4}}
	m := map[struct {
		X int
		S string
		A [2]int
	}]int{a: 10}
	fmt.Println(m[a])
	b := a
	b.A[1] = 5
	v, ok := m[b]
	fmt.Println(v, ok, len(m))
	m[b] = 20
	fmt.Println(m[a], m[b], len(m))
}
`,
		"10\n0 false 1\n10 20 2\n",
	);
});

test("an anonymous struct key set and read through a variable", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	m := map[struct{ X int }]int{}
	u := struct{ X int }{1}
	m[u] = 10
	fmt.Println(m[u], m[struct{ X int }{1}], m[struct{ X int }{2}])
	delete(m, u)
	fmt.Println(len(m))
}
`,
		"10 10 0\n0\n",
	);
});

test("an anonymous struct with an embedded field is a map key", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P struct{ N int }

func main() {
	k := struct {
		P
		M int
	}{P{1}, 2}
	m := map[struct {
		P
		M int
	}]int{k: 3}
	fmt.Println(m[k], m[struct {
		P
		M int
	}{P{1}, 2}])
	k.N = 9
	_, ok := m[k]
	fmt.Println(ok)
}
`,
		"3 3\nfalse\n",
	);
});

test("an anonymous struct key keeps its identity inside map[any]", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P struct{ S []int }

func main() {
	p := &P{[]int{1}}
	k := struct{ *P }{p}
	m := map[any]int{k: 7}
	fmt.Println(m[k])
}
`,
		"7\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
