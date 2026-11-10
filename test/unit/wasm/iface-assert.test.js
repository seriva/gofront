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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
