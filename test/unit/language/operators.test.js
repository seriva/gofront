// GoFront test suite — wide-int shifts and bitwise operators (J5.3)

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	assertProgramOutput,
	section,
	summarize,
	test,
} from "../helpers.js";

section("Wide-int shifts and bitwise operators (J5.3)");

test("int, uint and uintptr shifts above 32 bits match Go on all targets", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type MyInt int

func shiftL[T ~int | ~uint | ~uintptr](x T, n uint) T {
	return x << n
}

func shiftR[T ~int | ~uint | ~uintptr](x T, n uint) T {
	return x >> n
}

func shiftLAssign[T ~int | ~uint](x T, n uint) T {
	x <<= n
	return x
}

func main() {
	one := 1
	x := 1
	x <<= 40
	u := uint(1)
	var u2 uint = 1
	u2 <<= 40
	var p uintptr = 1
	p2 := p
	p2 <<= 40
	y := 1 << 41
	y >>= 40
	m := MyInt(1)

	fmt.Println(one<<40, x, u<<40, u2, p<<40, p2, y, shiftL[int](1, 40), shiftL[uint](1, 40))
	fmt.Println(shiftLAssign[int](1, 40), shiftR[int](1<<41, 40), shiftR[int](-1<<40, 40), m<<40)

	// Coincidence controls
	fmt.Println((one<<40)>>40, func() int { m := -1; return (m << 40) >> 40 }())
}
`,
		"1099511627776 1099511627776 1099511627776 1099511627776 1099511627776 1099511627776 2 1099511627776 1099511627776\n1099511627776 2 -1 1099511627776\n1 -1\n",
	);
});

test("int, uint and uintptr bitwise, unary ^, compound and generic ops match Go on all targets", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S struct{ F int }

func ptrBit[T ~int | ~uint](p *T, n uint) {
	*p <<= n
	*p |= 3
	*p &^= 1
}

func bwOr[T ~int | ~uint | ~uintptr](a, b T) T {
	return a | b
}

func bwAnd[T ~int | ~uint | ~uintptr](a, b T) T {
	return a & b
}

func bwXor[T ~int | ~uint | ~uintptr](a, b T) T {
	return a ^ b
}

func bwAndNot[T ~int | ~uint | ~uintptr](a, b T) T {
	return a &^ b
}

func bwNot[T ~int](a T) T {
	return ^a
}

func main() {
	x := 1099511627776
	y := x
	y |= 1
	y &= x | 1
	y ^= 3
	y &^= 2

	neg := -1
	neg2 := -(1 << 40)

	ux := uint(1) << 40
	uy := ux
	uy |= 1
	uy &^= 1

	px := uintptr(1) << 40
	py := px
	py |= 1

	mp := map[string]int{"k": 1}
	mp["k"] <<= 40
	mp["k"] |= 1

	pv := 1
	p := &pv
	*p <<= 40
	*p |= 1
	st := S{F: 1}
	st.F <<= 40
	st.F |= 2
	sl := []int{1}
	sl[0] <<= 40
	sl[0] |= 4
	var last int
	for k := 1; k > 0 && k < 1<<41; k <<= 40 {
		last = k
	}
	gv := 1
	ptrBit(&gv, 40)

	fmt.Println(x|1, x&x, x^1, ^x, (x|3)&^1)
	fmt.Println(bwOr[int](x, 1), bwAnd[int](x, x), bwXor[int](x, 1), bwAndNot[int](x|3, 1), bwNot[int](x))
	fmt.Println(y, ^neg, neg&^1, ^neg2, neg2&^1, neg2|1, neg2^1, bwNot[int](neg))
	fmt.Println(ux|1, ux&ux, ux^1, (ux|3)&^1, uy, bwOr[uint](ux, 1))
	fmt.Println(px|1, px&px, px^1, py, mp["k"], pv, st.F, sl[0], last, gv)
}
`,
		"1099511627777 1099511627776 1099511627777 -1099511627777 1099511627778\n1099511627777 1099511627776 1099511627777 1099511627778 -1099511627777\n1099511627776 0 -2 1099511627775 -1099511627776 -1099511627775 -1099511627775 0\n1099511627777 1099511627776 1099511627777 1099511627778 1099511627776 1099511627777\n1099511627777 1099511627776 1099511627777 1099511627777 1099511627777 1099511627777 1099511627778 1099511627780 1099511627776 1099511627778\n",
	);
});

test("int8 and uint32 wraparound controls stay intact", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	var a int8 = 100
	a <<= 1
	var b int8 = -128
	var u uint32 = 1
	u <<= 31
	var u2 uint32 = 0
	fmt.Println(a, ^b, b&^1, u, ^u2)
}
`,
		"-56 127 -128 2147483648 4294967295\n",
	);
	await assertAllTargetsOutput(
		`package main

import "fmt"

func gShiftL[T ~int8 | ~uint32](x T, n uint) T { return x << n }
func gOr[T ~int8 | ~uint32](a, b T) T       { return a | b }
func gNot[T ~int8 | ~uint32](a T) T         { return ^a }

func main() {
	fmt.Println(gShiftL[int8](100, 1), gShiftL[uint32](1, 31), gOr[int8](1, -128), gNot[int8](-128), gNot[uint32](0))
}
`,
		"-56 2147483648 -127 127 4294967295\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
