package main

import (
	"fmt"
	"math/bits"
)

func main() {
	// Add32, Add64, Add
	s32, c32 := bits.Add32(0xffffffff, 1, 0)
	fmt.Printf("%x %d\n", s32, c32)
	s32, c32 = bits.Add32(0xffffffff, 0, 1)
	fmt.Printf("%x %d\n", s32, c32)
	s64, c64 := bits.Add64(0xffffffffffffffff, 1, 0)
	fmt.Printf("%x %d\n", s64, c64)
	s64, c64 = bits.Add64(0xffffffffffffffff, 0, 1)
	fmt.Printf("%x %d\n", s64, c64)
	su, cu := bits.Add(0xffffffffffffffff, 2, 1)
	fmt.Printf("%x %d\n", su, cu)

	// Sub32, Sub64, Sub
	d32, b32 := bits.Sub32(0, 1, 0)
	fmt.Printf("%x %d\n", d32, b32)
	d32, b32 = bits.Sub32(5, 3, 1)
	fmt.Printf("%x %d\n", d32, b32)
	d64, b64 := bits.Sub64(0, 1, 0)
	fmt.Printf("%x %d\n", d64, b64)
	d64, b64 = bits.Sub64(5, 3, 1)
	fmt.Printf("%x %d\n", d64, b64)
	du, bu := bits.Sub(10, 4, 1)
	fmt.Printf("%x %d\n", du, bu)

	// Mul32, Mul64, Mul
	h32, l32 := bits.Mul32(0xffffffff, 0xffffffff)
	fmt.Printf("%x %x\n", h32, l32)
	h64, l64 := bits.Mul64(0xffffffffffffffff, 0xffffffffffffffff)
	fmt.Printf("%x %x\n", h64, l64)
	hu, lu := bits.Mul(0x123456789abcdef0, 2)
	fmt.Printf("%x %x\n", hu, lu)

	// Div32, Div64, Div
	q32, r32 := bits.Div32(1, 0, 2)
	fmt.Printf("%x %x\n", q32, r32)
	q64, r64 := bits.Div64(1, 0, 2)
	fmt.Printf("%x %x\n", q64, r64)
	qu, ru := bits.Div(0, 100, 7)
	fmt.Printf("%d %d\n", qu, ru)

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
	fmt.Println(bits.OnesCount(0), bits.OnesCount(0x1010101010101010))

	fmt.Println(bits.Len8(0), bits.Len8(1), bits.Len8(0x80), bits.Len8(0xff))
	fmt.Println(bits.Len16(0), bits.Len16(1), bits.Len16(0x8000), bits.Len16(0xffff))
	fmt.Println(bits.Len(0), bits.Len(1), bits.Len(0xffffffffffffffff))

	// RotateLeft8, RotateLeft16, RotateLeft
	fmt.Printf("%x %x\n", bits.RotateLeft8(0x81, 1), bits.RotateLeft8(0x81, -1))
	fmt.Printf("%x %x\n", bits.RotateLeft16(0x8001, 1), bits.RotateLeft16(0x8001, -1))
	fmt.Printf("%x %x\n", bits.RotateLeft(0x8000000000000001, 1), bits.RotateLeft(0x8000000000000001, -1))

	// Reverse8, Reverse16, Reverse, ReverseBytes
	fmt.Printf("%x %x\n", bits.Reverse8(0x80), bits.Reverse8(0x0f))
	fmt.Printf("%x %x\n", bits.Reverse16(0x8000), bits.Reverse16(0x00ff))
	fmt.Printf("%x\n", bits.Reverse(0x8000000000000000))
	fmt.Printf("%x\n", bits.ReverseBytes(0x123456789abcdef0))

	// UintSize
	fmt.Println(bits.UintSize)
}
