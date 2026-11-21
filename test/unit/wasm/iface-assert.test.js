// GoFront test suite — WASM dynamic interface assertions from `any`

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	assertProgramOutput,
	assertWasmProgramOutput,
	section,
	summarize,
	test,
} from "../helpers.js";

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

section(
	"WASM interface dispatch: methods promoted through an embedded pointer",
);

test("calls a method promoted through an embedded pointer of a struct value", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type Mer interface{ M() }

type Inner struct{}

func (i *Inner) M() { fmt.Println("inner") }

type PO struct{ *Inner }

func main() {
	var v any = PO{&Inner{}}
	m, ok := v.(Mer)
	fmt.Println(ok)
	m.M()
}
`,
		"true\ninner\n",
	);
});

// The JS backend still treats a pointer method promoted through two levels
// as outside the value's method set (plans/follow-ups.md).
test("calls a method promoted through two levels of embedding", async () => {
	await assertWasmProgramOutput(
		`package main

import "fmt"

type Mer interface{ M() }

type Inner struct{ name string }

func (i *Inner) M() { fmt.Println(i.name) }

type PO struct{ *Inner }

type PO2 struct{ PO }

func main() {
	var v any = PO2{PO{&Inner{"inner"}}}
	m, ok := v.(Mer)
	fmt.Println(ok)
	m.M()
	var p any = &PO2{PO{&Inner{"ptr"}}}
	p.(Mer).M()
}
`,
		"true\ninner\nptr\n",
	);
});

test("calls a promoted method with a nil embedded pointer", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type Mer interface{ M() }

type Inner struct{}

func (i *Inner) M() {
	if i == nil {
		fmt.Println("nil inner")
		return
	}
	fmt.Println("inner")
}

type PO struct{ *Inner }

func main() {
	var v any = PO{}
	v.(Mer).M()
}
`,
		"nil inner\n",
	);
});

section("WASM type tests against empty interfaces");

test("a type switch case naming a defined empty interface matches a non-nil value", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type B interface{}

func main() {
	var x any = B(1)
	switch v := x.(type) {
	case B:
		fmt.Println(v)
	}
}
`,
		"1\n",
	);
});

test("a type switch case naming interface{} or a chained empty interface matches a non-nil value", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type B interface{}
type C B

func main() {
	var x any = 1
	switch v := x.(type) {
	case interface{}:
		fmt.Println(v)
	}
	switch v := x.(type) {
	case C:
		fmt.Println(v)
	}
}
`,
		"1\n1\n",
	);
});

test("an empty-interface type switch still routes nil and multi-type cases", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type B interface{}

func main() {
	var n any
	switch n.(type) {
	case B:
		fmt.Println("B")
	case nil:
		fmt.Println("nil")
	}
	var x any = 1
	switch v := x.(type) {
	case B, string:
		fmt.Printf("%v %T\\n", v, v)
	}
}
`,
		"nil\n1 int\n",
	);
});

test("comma-ok assertions to empty interfaces succeed for non-nil values", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type B interface{}

func main() {
	var x any = 1
	v, ok := x.(B)
	fmt.Println(v, ok)
	w, ok2 := x.(interface{})
	fmt.Println(w, ok2)
	var n any
	_, ok3 := n.(B)
	_, ok4 := n.(interface{})
	fmt.Println(ok3, ok4)
}
`,
		"1 true\n1 true\nfalse false\n",
	);
});

test("single-value assertions to empty interfaces succeed for non-nil values and panic on nil", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type B interface{}

func main() {
	var x any = 1
	v := x.(B)
	w := x.(interface{})
	fmt.Println(v, w)
	var n any
	defer func() { fmt.Println(recover() != nil) }()
	_ = n.(B)
}
`,
		"1 1\ntrue\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
