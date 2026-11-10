// GoFront test suite — WASM dynamic interface assertions from `any`

import { fileURLToPath } from "node:url";
import { assertProgramOutput, section, summarize, test } from "../helpers.js";

section("WASM interface assertions: promoted methods");

test("a method promoted through an embedded pointer satisfies the interface", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type Mer interface{ M() }

type Inner struct{}

func (i *Inner) M() {}

type PO struct{ *Inner }

func main() {
	var v any = PO{}
	_, ok := v.(Mer)
	fmt.Println(ok)
	var w any = &PO{}
	_, ok = w.(Mer)
	fmt.Println(ok)
}
`,
		"true\ntrue\n",
	);
});

test("a pointer-receiver method of a value-embedded struct is not in the value's method set", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type Mer interface{ M() }

type Inner struct{}

func (i *Inner) M() {}

type PO struct{ Inner }

func main() {
	var v any = PO{}
	_, ok := v.(Mer)
	fmt.Println(ok)
	var w any = &PO{}
	_, ok = w.(Mer)
	fmt.Println(ok)
}
`,
		"false\ntrue\n",
	);
});

section("WASM interface assertions: Go-source stdlib named slices");

test("sort.IntSlice and sort.StringSlice satisfy sort.Interface from any", async () => {
	await assertProgramOutput(
		`package main

import (
	"fmt"
	"sort"
)

func main() {
	var v any = sort.IntSlice{1}
	_, ok := v.(sort.Interface)
	fmt.Println(ok)
	var w any = sort.StringSlice{"a"}
	_, ok = w.(sort.Interface)
	fmt.Println(ok)
}
`,
		"true\ntrue\n",
	);
});

test("a user-defined slice type with methods satisfies an interface from any", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type I interface{ Len() int }

type S []int

func (s S) Len() int { return len(s) }

func main() {
	var v any = S{1}
	_, ok := v.(I)
	fmt.Println(ok)
	var w any = []int{1}
	_, ok = w.(I)
	fmt.Println(ok)
}
`,
		"true\nfalse\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
