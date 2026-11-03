// GoFront test suite — math/bits (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.  A `uint` is a
// JavaScript Number, so cases that feed it use values below 2^53; the 64-bit
// forms cover the full range.

import { assertFourWay, section, test } from "../helpers.js";

section("math/bits (Go-source)");

test("wide arithmetic, counts, rotations and reversals", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"math/bits"
)

func main() {
	// Add32, Add64, Add
	s32, c32 := bits.Add32(0xffffffff, 1, 0)
	fmt.Printf("%x %d\\n", s32, c32)
	s32, c32 = bits.Add32(0xffffffff, 0, 1)
	fmt.Printf("%x %d\\n", s32, c32)
	s64, c64 := bits.Add64(0xffffffffffffffff, 1, 0)
	fmt.Printf("%x %d\\n", s64, c64)
	s64, c64 = bits.Add64(0xffffffffffffffff, 0, 1)
	fmt.Printf("%x %d\\n", s64, c64)
	su, cu := bits.Add(1<<50, 1<<50, 1)
	fmt.Printf("%x %d\\n", su, cu)

	// Sub32, Sub64, Sub
	d32, b32 := bits.Sub32(0, 1, 0)
	fmt.Printf("%x %d\\n", d32, b32)
	d32, b32 = bits.Sub32(5, 3, 1)
	fmt.Printf("%x %d\\n", d32, b32)
	d64, b64 := bits.Sub64(0x100000000, 1, 0)
	fmt.Printf("%x %d\\n", d64, b64)
	d64, b64 = bits.Sub64(5, 3, 1)
	fmt.Printf("%x %d\\n", d64, b64)
	du, bu := bits.Sub(10, 4, 1)
	fmt.Printf("%x %d\\n", du, bu)

	// Mul32, Mul64, Mul
	h32, l32 := bits.Mul32(0xffffffff, 0xffffffff)
	fmt.Printf("%x %x\\n", h32, l32)
	h64, l64 := bits.Mul64(0x100000000, 0x100000000)
	fmt.Printf("%x %x\\n", h64, l64)
	hu, lu := bits.Mul(0x100000000, 2)
	fmt.Printf("%x %x\\n", hu, lu)

	// Div32, Div64, Div
	q32, r32 := bits.Div32(1, 0, 2)
	fmt.Printf("%x %x\\n", q32, r32)
	q64, r64 := bits.Div64(1, 0, 2)
	fmt.Printf("%x %x\\n", q64, r64)
	qu, ru := bits.Div(0, 100, 7)
	fmt.Printf("%d %d\\n", qu, ru)

	// Rem32, Rem64, Rem
	fmt.Println(bits.Rem32(1, 0, 3))
	fmt.Println(bits.Rem64(1, 0, 3))
	fmt.Println(bits.Rem(0, 100, 7))

	// LeadingZeros, TrailingZeros, OnesCount, Len
	fmt.Println(bits.LeadingZeros8(0), bits.LeadingZeros8(1), bits.LeadingZeros8(0x80))
	fmt.Println(bits.LeadingZeros16(0), bits.LeadingZeros16(1), bits.LeadingZeros16(0x8000))
	fmt.Println(bits.LeadingZeros(0), bits.LeadingZeros(1))

	fmt.Println(bits.TrailingZeros8(0), bits.TrailingZeros8(2), bits.TrailingZeros8(0x80))
	fmt.Println(bits.TrailingZeros16(0), bits.TrailingZeros16(4), bits.TrailingZeros16(0x8000))
	fmt.Println(bits.TrailingZeros(0), bits.TrailingZeros(8))

	fmt.Println(bits.OnesCount8(0), bits.OnesCount8(0xff), bits.OnesCount8(0x55))
	fmt.Println(bits.OnesCount16(0), bits.OnesCount16(0xffff), bits.OnesCount16(0x1234))
	fmt.Println(bits.OnesCount(0), bits.OnesCount(0x10101010101010))

	fmt.Println(bits.Len8(0), bits.Len8(1), bits.Len8(0x80), bits.Len8(0xff))
	fmt.Println(bits.Len16(0), bits.Len16(1), bits.Len16(0x8000), bits.Len16(0xffff))
	fmt.Println(bits.Len(0), bits.Len(1), bits.Len(0x1fffffffffffff))

	// RotateLeft8, RotateLeft16, RotateLeft
	fmt.Printf("%x %x\\n", bits.RotateLeft8(0x81, 1), bits.RotateLeft8(0x81, -1))
	fmt.Printf("%x %x\\n", bits.RotateLeft16(0x8001, 1), bits.RotateLeft16(0x8001, -1))
	fmt.Printf("%x %x\\n", bits.RotateLeft64(0x8000000000000001, 1), bits.RotateLeft64(0x8000000000000001, -1))
	fmt.Printf("%x\\n", bits.RotateLeft(3, 2))

	// Reverse8, Reverse16, Reverse, ReverseBytes
	fmt.Printf("%x %x\\n", bits.Reverse8(0x80), bits.Reverse8(0x0f))
	fmt.Printf("%x %x\\n", bits.Reverse16(0x8000), bits.Reverse16(0x00ff))
	fmt.Printf("%x\\n", bits.Reverse64(0x8000000000000000))
	fmt.Printf("%x\\n", bits.ReverseBytes64(0x1234000000000000))

	// UintSize
	fmt.Println(bits.UintSize)
}
`,
		`0 1
0 1
0 1
0 1
8000000000001 0
ffffffff 1
1 0
ffffffff 0
1 0
5 0
fffffffe 1
1 0
0 200000000
80000000 0
8000000000000000 0
14 2
1
1
2
8 7 0
16 15 0
64 63
8 1 7
16 2 15
64 3
0 8 4
0 16 5
0 7
0 1 8 8
0 1 16 16
0 1 53
3 c0
3 c000
3 c000000000000000
c
1 f0
1 ff00
1
3412
64
`,
	);
});

test("counts at every width and edge value", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"math/bits"
)

func main() {
	for _, x := range []uint8{0, 1, 0x10, 0x80, 0xff} {
		fmt.Println(x, bits.LeadingZeros8(x), bits.TrailingZeros8(x), bits.OnesCount8(x), bits.Len8(x))
	}
	for _, x := range []uint16{0, 1, 0x0100, 0x8001, 0xffff} {
		fmt.Println(x, bits.LeadingZeros16(x), bits.TrailingZeros16(x), bits.OnesCount16(x), bits.Len16(x))
	}
	for _, x := range []uint32{0, 1, 2, 0x00f00000, 0x80000000, 0xffffffff} {
		fmt.Println(x, bits.LeadingZeros32(x), bits.TrailingZeros32(x), bits.OnesCount32(x), bits.Len32(x))
	}
	for _, x := range []uint64{0, 1, 1 << 40, 1<<63 | 1, 0xffffffffffffffff} {
		fmt.Println(x, bits.LeadingZeros64(x), bits.TrailingZeros64(x), bits.OnesCount64(x), bits.Len64(x))
	}
	for _, x := range []uint{0, 1, 1 << 40, 1<<52 + 1} {
		fmt.Println(x, bits.LeadingZeros(x), bits.TrailingZeros(x), bits.OnesCount(x), bits.Len(x))
	}
}
`,
		`0 8 8 0 0
1 7 0 1 1
16 3 4 1 5
128 0 7 1 8
255 0 0 8 8
0 16 16 0 0
1 15 0 1 1
256 7 8 1 9
32769 0 0 2 16
65535 0 0 16 16
0 32 32 0 0
1 31 0 1 1
2 30 1 1 2
15728640 8 20 4 24
2147483648 0 31 1 32
4294967295 0 0 32 32
0 64 64 0 0
1 63 0 1 1
1099511627776 23 40 1 41
9223372036854775809 0 0 2 64
18446744073709551615 0 0 64 64
0 64 64 0 0
1 63 0 1 1
1099511627776 23 40 1 41
4503599627370497 11 0 2 53
`,
	);
});

test("rotations and reversals at every width", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"math/bits"
)

func main() {
	fmt.Println(bits.RotateLeft8(0x96, 3), bits.RotateLeft8(0x96, -3), bits.RotateLeft8(0x96, 8), bits.RotateLeft8(0x96, 11))
	fmt.Println(bits.RotateLeft16(0x1234, 4), bits.RotateLeft16(0x1234, -4), bits.RotateLeft16(0x1234, 20))
	fmt.Println(bits.RotateLeft32(0x12345678, 8), bits.RotateLeft32(0x12345678, -8), bits.RotateLeft32(0x12345678, 0), bits.RotateLeft32(0x12345678, 40))
	fmt.Println(bits.RotateLeft64(0x0123456789abcdef, 12), bits.RotateLeft64(0x0123456789abcdef, -12), bits.RotateLeft64(0x0123456789abcdef, 64))
	fmt.Println(bits.Reverse8(0x12), bits.Reverse16(0x1234), bits.Reverse32(0x12345678))
	fmt.Println(bits.Reverse64(0x0123456789abcdef))
	fmt.Println(bits.ReverseBytes16(0x1234), bits.ReverseBytes32(0x12345678))
	fmt.Println(bits.ReverseBytes64(0x0123456789abcdef))
}
`,
		`180 210 150 180
9025 16675 9025
878082066 2014458966 305419896 878082066
3771334343958392850 16064359886828903100 81985529216486895
72 11336 510274632
17848844570815808640
13330 2018915346
17279655951921914625
`,
	);
});

test("Div and Rem panic like Go", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"math/bits"
)

func try(name string, f func()) {
	defer func() { fmt.Println(name, recover()) }()
	f()
}

func main() {
	try("Div32 overflow", func() { bits.Div32(1, 0, 1) })
	try("Div32 zero", func() { bits.Div32(0, 1, 0) })
	try("Div64 overflow", func() { bits.Div64(2, 0, 2) })
	try("Div64 zero", func() { bits.Div64(0, 1, 0) })
	try("Rem32 zero", func() { bits.Rem32(0, 1, 0) })
	try("Rem64 zero", func() { bits.Rem64(1, 0, 0) })
	q, r := bits.Div64(1, 5, 7)
	fmt.Println(q, r, bits.Rem64(1, 5, 7), bits.Rem64(0xffffffffffffffff, 5, 7))
	hi, lo := bits.Mul64(0xffffffffffffffff, 0xffffffffffffffff)
	fmt.Println(hi, lo)
}
`,
		`Div32 overflow runtime error: integer overflow
Div32 zero runtime error: integer divide by zero
Div64 overflow runtime error: integer overflow
Div64 zero runtime error: integer divide by zero
Rem32 zero runtime error: integer divide by zero
Rem64 zero runtime error: integer divide by zero
2635249153387078803 0 0 0
18446744073709551614 1
`,
	);
});
