// GoFront test suite — embedded fields and scalar method promotions

import {
	assertAllTargetsOutput,
	assertEqual,
	assertErrorContains,
	assertOutput,
	compile,
	compileHybrid,
	compileHybridProject,
	section,
	test,
} from "../helpers.js";

section("Embedded anonymous-struct aliases and multi-level embeds");

test("embedded anonymous-struct alias reads and writes (J4.1)", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type A = struct{ N int }
type Outer struct{ A }

func main() {
	o := Outer{A: A{N: 5}}
	fmt.Println(o.N, o.A.N)
	o.N = 10
	fmt.Println(o.N, o.A.N)
	o.A.N = 12
	fmt.Println(o.N, o.A.N)

	v := struct{ A }{A: A{N: 3}}
	fmt.Println(v.N, v.A.N)
	v.N = 9
	fmt.Println(v.N, v.A.N)
}
`,
		"5 5\n10 10\n12 12\n3 3\n9 9\n",
	);
});

test("multi-level embedded struct reads and writes on anonymous and named structs (J4.1)", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type AX struct{ X int }
type B struct{ AX }
type Named struct {
	B
	Y int
}

func main() {
	w := struct {
		B
		Y int
	}{B: B{AX: AX{X: 7}}, Y: 8}
	fmt.Println(w.X, w.AX.X, w.B.AX.X, w.Y)
	w.AX.X = 15
	fmt.Println(w.X, w.AX.X, w.B.X)

	n := Named{B: B{AX: AX{X: 7}}, Y: 8}
	n.AX.X = 99
	fmt.Println(n.X, n.AX.X, n.B.X, n.Y)
	n.X = 42
	fmt.Println(n.X, n.AX.X, n.B.AX.X)
}
`,
		"7 7 7 8\n15 15 15\n99 99 99 8\n42 42 42\n",
	);
});

section("Embedded named scalar method promotions");

const NUM_EMBED_SRC = `package main

import "fmt"

type Num int

func (n *Num) Inc()     { *n++ }
func (n Num) Val() int  { return int(n) }
func (n *Num) IsNil() bool { return n == nil }

type OuterPtr struct{ *Num }
type Outer struct{ Num }
`;

test("value-embedded scalar value-receiver method control (J4 control)", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Num int

func (n Num) Val() int { return int(n) }

type Outer struct{ Num }

func main() {
	o := Outer{4}
	fmt.Println(o.Val())
	var j interface{ Val() int } = Outer{4}
	fmt.Println(j.Val())
}
`,
		"4\n4\n",
	);
});

test("pointer-embedded scalar promotes Inc and Val directly and via interface (J4.2)", async () => {
	await assertAllTargetsOutput(
		`${NUM_EMBED_SRC}
func callValPanic(op OuterPtr) (panicked bool) {
	defer func() {
		if recover() != nil {
			panicked = true
		}
	}()
	_ = op.Val()
	return false
}

func main() {
	x := Num(10)
	op := OuterPtr{&x}
	op.Inc()
	fmt.Println(op.Val(), x)

	y := Num(3)
	fmt.Println((&OuterPtr{&y}).Val())

	var ii interface{ Inc() } = OuterPtr{&y}
	ii.Inc()
	fmt.Println(y)

	var iv interface{ Val() int } = OuterPtr{&y}
	fmt.Println(iv.Val())

	var ivPtr interface{ Val() int } = &OuterPtr{&y}
	fmt.Println(ivPtr.Val())

	fmt.Println(OuterPtr{nil}.IsNil())
	fmt.Println(callValPanic(OuterPtr{nil}))
}
`,
		"11 11\n3\n4\n4\n4\ntrue\ntrue\n",
	);
});

test("value-embedded scalar promotes pointer-receiver methods on js (J4.3)", async () => {
	await assertOutput(
		`${NUM_EMBED_SRC}
func main() {
	var o Outer
	o.Inc()
	fmt.Println(o.Val())

	var i interface{ Inc() } = &o
	i.Inc()
	fmt.Println(o.Val())

	_, okVal := any(o).(interface{ Inc() })
	_, okPtr := any(&o).(interface{ Inc() })
	fmt.Println(okVal, okPtr)
}
`,
		"1\n2\nfalse true\n",
		{ targets: ["js"] },
	);
});

const SCALAR_INTERIOR_MSG =
	"cannot take the address of a field, element or package-level variable of type";

const valueEmbedPtrCases = {
	"o.Inc()": `
type Num int
func (n *Num) Inc() { *n++ }
type Outer struct{ Num }
func Main() int { var o Outer; o.Inc(); return int(o.Num) }`,
	"o.Inc method value": `
type Num int
func (n *Num) Inc() { *n++ }
type Outer struct{ Num }
func Main() int { var o Outer; f := o.Inc; f(); return int(o.Num) }`,
	"(&o).Inc()": `
type Num int
func (n *Num) Inc() { *n++ }
type Outer struct{ Num }
func Main() int { var o Outer; (&o).Inc(); return int(o.Num) }`,
	"(*Outer).Inc method expr": `
type Num int
func (n *Num) Inc() { *n++ }
type Outer struct{ Num }
func Main() int { var o Outer; fn := (*Outer).Inc; fn(&o); return int(o.Num) }`,
	"var i interface{ Inc() } = &o": `
type Num int
func (n *Num) Inc() { *n++ }
type Outer struct{ Num }
func Main() int { var o Outer; var i interface{ Inc() } = &o; i.Inc(); return int(o.Num) }`,
	"interface{ Inc() }(&o) conversion": `
type Num int
func (n *Num) Inc() { *n++ }
type Outer struct{ Num }
func Main() int { var o Outer; i := interface{ Inc() }(&o); i.Inc(); return int(o.Num) }`,
	"multi-level *Mid embedding Num": `
type Num int
func (n *Num) Inc() { *n++ }
type Mid struct{ Num }
type Top struct{ *Mid }
func Main() int { t := Top{&Mid{}}; t.Inc(); return int(t.Num) }`,
	"multi-level *Mid interface{ Inc() }": `
type Num int
func (n *Num) Inc() { *n++ }
type Mid struct{ Num }
type Top struct{ *Mid }
func Main() int { t := Top{&Mid{}}; var i interface{ Inc() } = t; i.Inc(); return int(t.Num) }`,
	"multi-level *Mid Top.Inc method expr": `
type Num int
func (n *Num) Inc() { *n++ }
type Mid struct{ Num }
type Top struct{ *Mid }
func Main() int { t := Top{&Mid{}}; fn := Top.Inc; fn(t); return int(t.Num) }`,
	"multi-level *Mid t.Inc method value": `
type Num int
func (n *Num) Inc() { *n++ }
type Mid struct{ Num }
type Top struct{ *Mid }
func Main() int { t := Top{&Mid{}}; f := t.Inc; f(); return int(t.Num) }`,
	"multi-level *Mid Deep.Inc method expr": `
type Num int
func (n *Num) Inc() { *n++ }
type Mid struct{ Num }
type Top struct{ *Mid }
type Deep struct{ Top }
func Main() int { d := Deep{Top{&Mid{}}}; fn := Deep.Inc; fn(d); return int(d.Num) }`,
};

for (const target of ["wasm", "both"]) {
	for (const [name, body] of Object.entries(valueEmbedPtrCases)) {
		test(`${target}: value-embedded scalar pointer promotion ${name} is rejected (J4.3)`, () => {
			const { errors } = compile(
				`//gofront:target ${target}\npackage main\n${body}\n`,
			);
			assertErrorContains(errors, SCALAR_INTERIOR_MSG);
			assertErrorContains(errors, "of type Num");
			assertErrorContains(errors, `in a ${target} package`);
		});
	}
}

test("js: all value-embedded scalar pointer-receiver promotion forms compile and run (J4.3)", async () => {
	for (const [name, body] of Object.entries(valueEmbedPtrCases)) {
		const { errors } = compile(`package main\n${body}\n`);
		assertEqual(errors.length, 0, `${name}: unexpected errors`);
	}
	await assertOutput(
		`package main
import "fmt"
type Num int
func (n *Num) Inc() { *n++ }
type Mid struct{ Num }
type Top struct{ *Mid }
type Outer struct{ Num }
func main() {
	var o Outer
	f := o.Inc
	f()
	(&o).Inc()
	fn := (*Outer).Inc
	fn(&o)
	i := interface{ Inc() }(&o)
	i.Inc()
	t := Top{&Mid{}}
	t.Inc()
	var it interface{ Inc() } = t
	it.Inc()
	fnTop := Top.Inc
	fnTop(t)
	fmt.Println(o.Num, t.Num)
}
`,
		"4 3\n",
		{ targets: ["js"] },
	);
});

test("value-embedded named array promotes pointer and value methods via interface on all targets", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Arr [2]int

func (a *Arr) Set(i, v int) { a[i] = v }
func (a Arr) Get(i int) int { return a[i] }

type A1 struct{ Arr }
type A2 struct{ *Arr }
type WrapA struct{ A1 }

func main() {
	var a A1
	var i1 interface {
		Set(int, int)
		Get(int) int
	} = &a
	i1.Set(0, 7)
	i1.Set(1, 8)
	fmt.Println(a.Get(0), i1.Get(0))
	fmt.Println(a.Get(1), i1.Get(1))

	_, ok1 := any(&a).(interface{ Set(int, int) })
	_, ok1v := any(a).(interface{ Set(int, int) })
	fmt.Println(ok1, ok1v)

	var backing Arr
	a2 := A2{&backing}
	var i2 interface {
		Set(int, int)
		Get(int) int
	} = a2
	i2.Set(0, 11)
	fmt.Println(backing[0], a2.Get(0), i2.Get(0))

	var w WrapA
	var iw interface{ Set(int, int) } = &w
	iw.Set(1, 42)
	fmt.Println(w.Get(1))
}
`,
		"7 7\n8 8\ntrue false\n11 11 11\n42\n",
	);
});

test("both/wasm: runtime interface assertions on value-embedded scalars match wasm and do not emit invalid WasmGC", async () => {
	await assertOutput(
		`package main

import "fmt"

type Num int

func (n *Num) Inc()    { *n++ }
func (n Num) Val() int { return int(n) }

type S []int

func (s *S) Push(x int) { *s = append(*s, x) }

type Outer struct{ Num }
type OuterS struct{ S }
type Mid struct{ Num }
type Top struct{ *Mid }
type OuterPtr struct{ *Num }
type Foo struct{ X int }

func (f *Foo) Inc() { f.X++ }
func (f *Foo) Push(x int) {
	f.X += x
}

func main() {
	var o Outer
	var ao any = &o
	_, okPtr := ao.(interface{ Inc() })
	_, okVal := any(o).(interface{ Val() int })
	hitSwitch := false
	switch v := ao.(type) {
	case interface{ Inc() }:
		v.Inc()
		hitSwitch = true
	default:
	}

	var os OuterS
	_, okSlice := any(&os).(interface{ Push(int) })

	t := Top{&Mid{}}
	_, okTop := any(t).(interface{ Inc() })
	_, okTopPtr := any(&t).(interface{ Inc() })

	n := Num(5)
	op := OuterPtr{&n}
	_, okOuterPtr := any(op).(interface{ Inc() })

	var af any = &Foo{X: 1}
	if v, ok := af.(interface{ Inc() }); ok {
		v.Inc()
	}
	if v, ok := af.(interface{ Push(int) }); ok {
		v.Push(2)
	}

	fmt.Println(okPtr, okVal, hitSwitch, o.Val(), okSlice, okTop, okTopPtr, okOuterPtr, af.(*Foo).X)
}
`,
		"false true false 0 false false false true 4\n",
		{ targets: ["both", "wasm"] },
	);
});

test("both: compileHybrid on //gofront:target both agrees on any(&Outer).(interface{ Inc() })", () => {
	const { jsRes, wasmRes } = compileHybrid(`//gofront:target both
package main
type Num int
func (n *Num) Inc() { *n++ }
type Outer struct{ Num }
type Foo struct{ S string }
func (f *Foo) Inc() { f.S += "!" }
func Main() int {
	var o Outer
	var a any = &o
	if _, ok := a.(interface{ Inc() }); ok {
		return 1
	}
	return 0
}
`).run("Main");
	assertEqual(jsRes, 0);
	assertEqual(Number(wasmRes), 0);
});

test("both: cross-package Outer does not satisfy interface{ Inc() }", async () => {
	const { lines } = await compileHybridProject({
		"gofront.json": JSON.stringify({ target: "both" }),
		"lib/lib.go": `//gofront:target both
package lib
type Num int
func (n *Num) Inc() { *n++ }
type Outer struct{ Num }
`,
		"main.go": `//gofront:target both
package main
import (
	"fmt"
	"./lib"
)
type Foo struct{ X int }
func (f *Foo) Inc() { f.X++ }
func main() {
	var o lib.Outer
	var a any = &o
	_, ok := a.(interface{ Inc() })
	fmt.Println(ok)
}
`,
	});
	assertEqual(lines.join("\n"), "false");
});

test("shallower embed method shadows deeper scalar or struct method on all targets", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
type Num int
func (n *Num) Inc() { *n++ }
type Mid struct{ Num }
type Other struct{}
func (o *Other) Inc() { fmt.Println("other") }
type ShadowNum struct{ Mid; Other }

type InnerS struct{}
func (s *InnerS) Ping() { fmt.Println("inner") }
type MidS struct{ InnerS }
type TopS struct{}
func (t *TopS) Ping() { fmt.Println("top") }
type ShadowStruct struct{ MidS; TopS }

func main() {
	var sn ShadowNum
	sn.Inc()
	var i1 interface{ Inc() } = &sn
	i1.Inc()

	var ss ShadowStruct
	ss.Ping()
	var i2 interface{ Ping() } = &ss
	i2.Ping()
}
`,
		"other\nother\ntop\ntop\n",
	);
});

section("Cross-package js -> both scalar-interior method promotions");

test("js package importing both package uses promoted scalar-interior methods on all call forms", async () => {
	const { lines } = await compileHybridProject({
		"lib/lib.go": `//gofront:target both
package lib

type Num int

func (n *Num) Inc()    { *n++ }
func (n Num) Val() int { return int(n) }

type ErrStr string

func (e *ErrStr) Error() string { return string(*e) }

type Outer struct{ Num }
type Mid struct{ Num }
type Top struct{ *Mid }
type Deep struct{ Top }
type OuterErr struct{ ErrStr }
`,
		"main.go": `//gofront:target js
package main

import (
	"fmt"
	"./lib"
)

type Incer interface{ Inc() }

func checkIface[I any](a any) bool {
	_, ok := a.(I)
	return ok
}

func main() {
	var o lib.Outer
	o.Inc()
	(&o).Inc()
	f := o.Inc
	f()
	fn := (*lib.Outer).Inc
	fn(&o)
	var i interface{ Inc() } = &o
	i.Inc()

	_, okVal := any(o).(interface{ Inc() })
	_, okPtr := any(&o).(interface{ Inc() })
	_, okNamed := any(&o).(Incer)
	okGen := checkIface[Incer](&o)

	t := lib.Top{&lib.Mid{}}
	t.Inc()
	lib.Top.Inc(t)
	var it interface{ Inc() } = t
	it.Inc()
	_, okTop := any(t).(interface{ Inc() })
	_, okTopPtr := any(&t).(interface{ Inc() })

	d := lib.Deep{Top: lib.Top{Mid: &lib.Mid{}}}
	d.Inc()
	lib.Deep.Inc(d)

	oe := lib.OuterErr{ErrStr: "boom"}
	var e error = &oe
	_, okErrVal := any(oe).(error)
	_, okErrPtr := any(&oe).(error)

	fmt.Println(o.Val(), okVal, okPtr, okNamed, okGen, t.Val(), okTop, okTopPtr, d.Val(), e.Error(), okErrVal, okErrPtr)
}
`,
	});
	assertEqual(
		lines.join("\n"),
		"5 false true true true 3 true true 2 boom false true",
	);
});

test("mixed js + both project keeps js promotions while both runtime assertions stay false", async () => {
	const { lines } = await compileHybridProject({
		"lib/lib.go": `//gofront:target both
package lib

type Num int

func (n *Num) Inc()    { *n++ }
func (n Num) Val() int { return int(n) }

type ErrStr string

func (e *ErrStr) Error() string { return string(*e) }

type Outer struct{ Num }
type Mid struct{ Num }
type Top struct{ *Mid }
type OuterErr struct{ ErrStr }
`,
		"helper/helper.go": `//gofront:target both
package helper

import "../lib"

type Incer interface{ Inc() }

func checkGeneric[I any](a any) bool {
	_, ok := a.(I)
	return ok
}

func CheckOuter(o *lib.Outer) (bool, bool, bool, bool) {
	var a any = o
	_, okAnon := a.(interface{ Inc() })
	_, okNamed := a.(Incer)
	okGen := checkGeneric[Incer](a)
	hitSwitch := false
	switch a.(type) {
	case interface{ Inc() }:
		hitSwitch = true
	}
	return okAnon, okNamed, okGen, hitSwitch
}

func CheckTop(t lib.Top) (bool, bool) {
	_, okVal := any(t).(interface{ Inc() })
	_, okPtr := any(&t).(interface{ Inc() })
	return okVal, okPtr
}

func CheckErr(oe *lib.OuterErr) bool {
	_, ok := any(oe).(error)
	return ok
}
`,
		"main.go": `//gofront:target js
package main

import (
	"fmt"
	"./helper"
	"./lib"
)

func main() {
	var o lib.Outer
	o.Inc()
	var i interface{ Inc() } = &o
	i.Inc()
	_, jsOk := any(&o).(interface{ Inc() })

	a1, a2, a3, a4 := helper.CheckOuter(&o)
	t := lib.Top{&lib.Mid{}}
	t.Inc()
	t1, t2 := helper.CheckTop(t)
	oe := lib.OuterErr{ErrStr: "bad"}
	e1 := helper.CheckErr(&oe)

	fmt.Println(o.Val(), jsOk, a1, a2, a3, a4, t.Val(), t1, t2, e1)
}
`,
	});
	assertEqual(
		lines.join("\n"),
		"2 true false false false false 1 false false false",
	);
});

test("both/wasm: error assertion and generic assertion on scalar-interior embed match wasm", async () => {
	await assertOutput(
		`package main

import "fmt"

type ErrStr string

func (e *ErrStr) Error() string { return string(*e) }

type OuterErr struct{ ErrStr }

type Num int

func (n *Num) Inc() { *n++ }

type Outer struct{ Num }
type Incer interface{ Inc() }

func checkIface[I any](a any) bool {
	_, ok := a.(I)
	return ok
}

func main() {
	oe := OuterErr{ErrStr: "bad"}
	_, okErr := any(&oe).(error)
	var o Outer
	okGen := checkIface[Incer](&o)
	fmt.Println(okErr, okGen, fmt.Sprint(any(&oe)))
}
`,
		"false false &{bad}\n",
		{ targets: ["both", "wasm"] },
	);
});

test("both/wasm: panicking assertion and shadowing on scalar-interior embed match wasm", async () => {
	await assertOutput(
		`package main

import "fmt"

type Num int

func (n *Num) Inc() { *n++ }

type Outer struct{ Num }
func (o Outer) A() {}

type HasBoth interface {
	A()
	Inc()
}

type Other struct{}
func (o *Other) Inc() {}
type Mid struct{ Num }
type ShadowOther struct{ Mid; Other }
type ShadowDirect struct{ Num }
func (s *ShadowDirect) Inc() {}

func main() {
	var o Outer
	var a any = &o
	var panicked string
	func() {
		defer func() {
			if r := recover(); r != nil {
				panicked = r.(error).Error()
			}
		}()
		_ = a.(HasBoth)
	}()

	var so ShadowOther
	_, okOther := any(&so).(interface{ Inc() })
	var sd ShadowDirect
	_, okDirect := any(&sd).(interface{ Inc() })
	fmt.Println(panicked != "", okOther, okDirect)
}
`,
		"true true true\n",
		{ targets: ["both", "wasm"] },
	);
});
