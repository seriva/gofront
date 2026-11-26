// GoFront test suite — embedded fields and scalar method promotions

import {
	assertAllTargetsOutput,
	assertOutput,
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
