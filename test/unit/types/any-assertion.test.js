// test/unit/types/any-assertion.test.js
// A value of declared type `any` needs a type assertion before it flows into a
// concrete type, whatever the statement form.

import {
	assertAllTargetsOutput,
	assertErrorContains,
	compile,
	compileWasm,
	section,
	test,
} from "../helpers.js";

section("any to concrete assertions");

function errorsOn(target, src) {
	if (target === "wasm") return compileWasm(src).errors ?? [];
	return compile(src, { target }).errors ?? [];
}

const TARGETS = ["js", "both", "wasm"];

function negative(name, src, needle = "need type assertion") {
	for (const target of TARGETS) {
		test(`${name} is rejected (${target})`, () => {
			assertErrorContains(errorsOn(target, src), needle);
		});
	}
}

function positive(name, src) {
	for (const target of TARGETS) {
		test(`${name} compiles (${target})`, () => {
			const errs = errorsOn(target, src);
			if (errs.length > 0) throw new Error(`unexpected errors: ${errs}`);
		});
	}
}

// Task 2.1: plain assignment
negative(
	"a = b with b any",
	`package main
type A struct{ X int }
func main() {
	var a A
	var b any = A{1}
	a = b
	_ = a
}`,
);
positive(
	"any-to-any assignment and nil to error",
	`package main
func main() {
	var b any = 1
	var c any
	c = b
	var e error
	var x any
	_ = x
	e = nil
	_, _ = c, e
}`,
);

// Task 2.2: comma-ok map, tuple =, mixed :=
negative(
	"comma-ok map assignment into concrete",
	`package main
type A struct{ X int }
func main() {
	m := map[string]any{"k": A{1}}
	var a A
	var ok bool
	a, ok = m["k"]
	_, _ = a, ok
}`,
);
negative(
	"tuple assignment from (any, error)",
	`package main
func getPair() (any, error) { return 1, nil }
func main() {
	var n int
	var err error
	n, err = getPair()
	_, _ = n, err
}`,
);
negative(
	"mixed := redeclaration from (any, error)",
	`package main
func getPair() (any, error) { return 1, nil }
func main() {
	var n int
	n, err := getPair()
	_, _ = n, err
}`,
);
positive(
	"fresh comma-ok := from map[string]any",
	`package main
func main() {
	m := map[string]any{"k": 1}
	x, ok := m["k"]
	_, _ = x, ok
}`,
);

// Task 2.3: conversions
negative(
	"(*int)(x) with x any",
	`package main
func main() {
	var x any
	p := (*int)(x)
	_ = p
}`,
);
negative(
	"int(x) with x any",
	`package main
func main() {
	var x any = 1
	n := int(x)
	_ = n
}`,
);
positive(
	"any(x), error(nil) and interface conversions",
	`package main
type I interface{ M() }
type T struct{}
func (T) M() {}
func main() {
	var x any = 1
	y := any(x)
	e := error(nil)
	var v I = T{}
	i := I(v)
	_, _, _ = y, e, i
}`,
);

// Task 2.4: type-switch default and multi-type captures
negative(
	"type-switch default binding assigned to concrete",
	`package main
type A struct{ X int }
type B struct{}
func main() {
	var x any = 3
	switch v := x.(type) {
	case B:
		_ = v
	default:
		var a A = v
		_ = a
	}
}`,
);
positive(
	"multi-type capture to any",
	`package main
type A struct{}
type B struct{}
func main() {
	var x any = A{}
	switch v := x.(type) {
	case A, B:
		var y any = v
		_ = y
	}
}`,
);
test("type-switch default prints the value on all targets", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	var x any = 3
	switch v := x.(type) {
	case string:
		fmt.Println("string", v)
	default:
		fmt.Println(v)
	}
}
`,
		"3\n",
	);
});

// any to a non-empty interface
negative(
	"e = b with b any and e error",
	`package main
func main() {
	var b any
	var e error
	e = b
	_ = e
}`,
	"cannot use b (variable of type any) as error value in assignment: need type assertion",
);
negative(
	"var s fmt.Stringer = b with b any",
	`package main
import "fmt"
func main() {
	var b any
	var s fmt.Stringer = b
	_ = s
}`,
);
negative(
	"any passed to a user interface parameter",
	`package main
type I interface{ M() }
func use(i I) { _ = i }
func main() {
	var b any
	use(b)
}`,
);
positive(
	"any to any, asserted any to error, concrete to error",
	`package main
type MyErr struct{}
func (*MyErr) Error() string { return "e" }
func main() {
	var b any
	var c any = b
	var e error
	e, _ = b.(error)
	var e2 error = &MyErr{}
	_, _, _ = c, e, e2
}`,
);
test("asserting any to error runs on all targets", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"errors"
	"fmt"
)

func main() {
	var b any = errors.New("boom")
	var e error
	e = b.(error)
	fmt.Println(e)
}
`,
		"boom\n",
	);
});

section("conversions to interface types");

test("I(T{}) converts a concrete value to an interface", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type I interface{ M() }
type T struct{}

func (T) M() { fmt.Println("m") }

func main() {
	v := I(T{})
	v.M()
}
`,
		"m\n",
	);
});
test("I(nil), error(nil) and I(j) from a wider interface convert", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type I interface{ M() }
type J interface {
	M()
	N()
}
type T struct{}

func (T) M() { fmt.Println("m") }
func (T) N() {}

func main() {
	a := I(nil)
	fmt.Println(a == nil)
	e := error(nil)
	fmt.Println(e == nil)
	var j J = T{}
	b := I(j)
	b.M()
}
`,
		"true\ntrue\nm\n",
	);
});
negative(
	"I(T2{}) with T2 missing M",
	`package main
type I interface{ M() }
type T2 struct{}
func main() {
	v := I(T2{})
	_ = v
}`,
	"does not implement",
);

// I(a) with a declared any and I non-empty needs an assertion, like the
// assignment form.
negative(
	"I(a) with a any and I non-empty",
	`package main
type I interface{ M() }
func main() {
	var a any
	_ = I(a)
}`,
	"cannot convert a (variable of type any) to type I: need type assertion",
);
negative(
	"an interface literal conversion of a declared any",
	`package main
func main() {
	var a any
	_ = interface{ M() }(a)
}`,
);

test("I(a.(I)), I(T{}), I(nil) and any(a) still convert", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type I interface{ M() }
type T struct{}

func (T) M() { fmt.Println("m") }

func main() {
	var a any = T{}
	I(a.(I)).M()
	I(T{}).M()
	fmt.Println(I(nil) == nil)
	fmt.Println(any(a) != nil)
}
`,
		"m\nm\ntrue\ntrue\n",
	);
});
