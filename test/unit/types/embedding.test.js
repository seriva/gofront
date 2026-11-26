// GoFront test suite — embedded fields and scalar method promotions

import { assertAllTargetsOutput, section, test } from "../helpers.js";

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
