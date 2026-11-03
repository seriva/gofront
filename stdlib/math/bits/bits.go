//go:build gofront

//gofront:target both

// Copyright 2017 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Package bits implements bit counting and manipulation functions for the
// predeclared unsigned integer types.
//
// Go's lookup tables (len8tab, ntz8tab, pop8tab, rev8tab) are replaced by
// shift arithmetic with the same results. The Len, LeadingZeros,
// TrailingZeros and OnesCount functions carry host natives where the host
// has a single instruction for them.
package bits

// UintSize is the size of a uint in bits.
const UintSize = 64

// Go panics with a runtime.Error; GoFront's recovered run-time errors are
// their message, so these are the same strings.
const (
	overflowError = "runtime error: integer overflow"
	divideError   = "runtime error: integer divide by zero"
)

// len8 is the bit length of x, which is below 256.
func len8(x uint32) int {
	n := 0
	if x >= 1<<4 {
		x >>= 4
		n = 4
	}
	if x >= 1<<2 {
		x >>= 2
		n += 2
	}
	if x >= 1<<1 {
		x >>= 1
		n++
	}
	if x >= 1 {
		n++
	}
	return n
}

// --- LeadingZeros ---

// LeadingZeros returns the number of leading zero bits in x; the result is UintSize for x == 0.
//
//gofront:native bits.LeadingZeros
func LeadingZeros(x uint) int { return 64 - Len64(uint64(x)) }

// LeadingZeros8 returns the number of leading zero bits in x; the result is 8 for x == 0.
//
//gofront:native bits.LeadingZeros8
func LeadingZeros8(x uint8) int { return 8 - Len8(x) }

// LeadingZeros16 returns the number of leading zero bits in x; the result is 16 for x == 0.
//
//gofront:native bits.LeadingZeros16
func LeadingZeros16(x uint16) int { return 16 - Len16(x) }

// LeadingZeros32 returns the number of leading zero bits in x; the result is 32 for x == 0.
//
//gofront:native bits.LeadingZeros32
func LeadingZeros32(x uint32) int { return 32 - Len32(x) }

// LeadingZeros64 returns the number of leading zero bits in x; the result is 64 for x == 0.
//
//gofront:native bits.LeadingZeros64
func LeadingZeros64(x uint64) int { return 64 - Len64(x) }

// --- TrailingZeros ---

// TrailingZeros returns the number of trailing zero bits in x; the result is UintSize for x == 0.
//
//gofront:native bits.TrailingZeros
func TrailingZeros(x uint) int { return TrailingZeros64(uint64(x)) }

// TrailingZeros8 returns the number of trailing zero bits in x; the result is 8 for x == 0.
//
//gofront:native bits.TrailingZeros8
func TrailingZeros8(x uint8) int {
	if x == 0 {
		return 8
	}
	return len8(uint32(x&-x)) - 1
}

// TrailingZeros16 returns the number of trailing zero bits in x; the result is 16 for x == 0.
//
//gofront:native bits.TrailingZeros16
func TrailingZeros16(x uint16) int {
	if x == 0 {
		return 16
	}
	return Len16(x&-x) - 1
}

// TrailingZeros32 returns the number of trailing zero bits in x; the result is 32 for x == 0.
//
//gofront:native bits.TrailingZeros32
func TrailingZeros32(x uint32) int {
	if x == 0 {
		return 32
	}
	return Len32(x&-x) - 1
}

// TrailingZeros64 returns the number of trailing zero bits in x; the result is 64 for x == 0.
//
//gofront:native bits.TrailingZeros64
func TrailingZeros64(x uint64) int {
	if x == 0 {
		return 64
	}
	return Len64(x&-x) - 1
}

// --- OnesCount ---

const (
	m0 = 0x5555555555555555 // 01010101 ...
	m1 = 0x3333333333333333 // 00110011 ...
	m2 = 0x0f0f0f0f0f0f0f0f // 00001111 ...
)

// OnesCount returns the number of one bits ("population count") in x.
//
//gofront:native bits.OnesCount
func OnesCount(x uint) int { return OnesCount64(uint64(x)) }

// OnesCount8 returns the number of one bits ("population count") in x.
//
//gofront:native bits.OnesCount8
func OnesCount8(x uint8) int { return OnesCount32(uint32(x)) }

// OnesCount16 returns the number of one bits ("population count") in x.
//
//gofront:native bits.OnesCount16
func OnesCount16(x uint16) int { return OnesCount32(uint32(x)) }

// OnesCount32 returns the number of one bits ("population count") in x.
//
//gofront:native bits.OnesCount32
func OnesCount32(x uint32) int {
	const m = 1<<32 - 1
	x = x>>1&(m0&m) + x&(m0&m)
	x = x>>2&(m1&m) + x&(m1&m)
	x = (x>>4 + x) & (m2 & m)
	x += x >> 8
	x += x >> 16
	return int(x) & (1<<6 - 1)
}

// OnesCount64 returns the number of one bits ("population count") in x.
//
//gofront:native bits.OnesCount64
func OnesCount64(x uint64) int {
	const m = 1<<64 - 1
	x = x>>1&(m0&m) + x&(m0&m)
	x = x>>2&(m1&m) + x&(m1&m)
	x = (x>>4 + x) & (m2 & m)
	x += x >> 8
	x += x >> 16
	x += x >> 32
	return int(x & (1<<7 - 1)) // masked before int(): a uint64 above 2^53 does not survive int() in JS
}

// --- RotateLeft ---

// RotateLeft returns the value of x rotated left by (k mod UintSize) bits.
// To rotate x right by k bits, call RotateLeft(x, -k).
func RotateLeft(x uint, k int) uint { return uint(RotateLeft64(uint64(x), k)) }

// RotateLeft8 returns the value of x rotated left by (k mod 8) bits.
func RotateLeft8(x uint8, k int) uint8 {
	const n = 8
	s := uint(k) & (n - 1)
	return x<<s | x>>(n-s)
}

// RotateLeft16 returns the value of x rotated left by (k mod 16) bits.
func RotateLeft16(x uint16, k int) uint16 {
	const n = 16
	s := uint(k) & (n - 1)
	return x<<s | x>>(n-s)
}

// RotateLeft32 returns the value of x rotated left by (k mod 32) bits.
func RotateLeft32(x uint32, k int) uint32 {
	const n = 32
	s := uint(k) & (n - 1)
	return x<<s | x>>(n-s)
}

// RotateLeft64 returns the value of x rotated left by (k mod 64) bits.
func RotateLeft64(x uint64, k int) uint64 {
	const n = 64
	s := uint(k) & (n - 1)
	return x<<s | x>>(n-s)
}

// --- Reverse ---

// Reverse returns the value of x with its bits in reversed order.
func Reverse(x uint) uint { return uint(Reverse64(uint64(x))) }

// Reverse8 returns the value of x with its bits in reversed order.
func Reverse8(x uint8) uint8 { return uint8(Reverse32(uint32(x)) >> 24) }

// Reverse16 returns the value of x with its bits in reversed order.
func Reverse16(x uint16) uint16 { return uint16(Reverse32(uint32(x)) >> 16) }

// Reverse32 returns the value of x with its bits in reversed order.
func Reverse32(x uint32) uint32 {
	const m = 1<<32 - 1
	x = x>>1&(m0&m) | x&(m0&m)<<1
	x = x>>2&(m1&m) | x&(m1&m)<<2
	x = x>>4&(m2&m) | x&(m2&m)<<4
	return ReverseBytes32(x)
}

// Reverse64 returns the value of x with its bits in reversed order.
func Reverse64(x uint64) uint64 {
	const m = 1<<64 - 1
	x = x>>1&(m0&m) | x&(m0&m)<<1
	x = x>>2&(m1&m) | x&(m1&m)<<2
	x = x>>4&(m2&m) | x&(m2&m)<<4
	return ReverseBytes64(x)
}

// --- ReverseBytes ---

const m3 = 0x00ff00ff00ff00ff
const m4 = 0x0000ffff0000ffff

// ReverseBytes returns the value of x with its bytes in reversed order.
func ReverseBytes(x uint) uint { return uint(ReverseBytes64(uint64(x))) }

// ReverseBytes16 returns the value of x with its bytes in reversed order.
func ReverseBytes16(x uint16) uint16 { return x>>8 | x<<8 }

// ReverseBytes32 returns the value of x with its bytes in reversed order.
func ReverseBytes32(x uint32) uint32 {
	const m = 1<<32 - 1
	x = x>>8&(m3&m) | x&(m3&m)<<8
	return x>>16 | x<<16
}

// ReverseBytes64 returns the value of x with its bytes in reversed order.
func ReverseBytes64(x uint64) uint64 {
	const m = 1<<64 - 1
	x = x>>8&(m3&m) | x&(m3&m)<<8
	x = x>>16&(m4&m) | x&(m4&m)<<16
	return x>>32 | x<<32
}

// --- Len ---

// Len returns the minimum number of bits required to represent x; the result is 0 for x == 0.
//
//gofront:native bits.Len
func Len(x uint) int { return Len64(uint64(x)) }

// Len8 returns the minimum number of bits required to represent x; the result is 0 for x == 0.
//
//gofront:native bits.Len8
func Len8(x uint8) int { return len8(uint32(x)) }

// Len16 returns the minimum number of bits required to represent x; the result is 0 for x == 0.
//
//gofront:native bits.Len16
func Len16(x uint16) (n int) {
	if x >= 1<<8 {
		x >>= 8
		n = 8
	}
	return n + len8(uint32(x))
}

// Len32 returns the minimum number of bits required to represent x; the result is 0 for x == 0.
//
//gofront:native bits.Len32
func Len32(x uint32) (n int) {
	if x >= 1<<16 {
		x >>= 16
		n = 16
	}
	if x >= 1<<8 {
		x >>= 8
		n += 8
	}
	return n + len8(x)
}

// Len64 returns the minimum number of bits required to represent x; the result is 0 for x == 0.
//
//gofront:native bits.Len64
func Len64(x uint64) (n int) {
	if x >= 1<<32 {
		x >>= 32
		n = 32
	}
	if x >= 1<<16 {
		x >>= 16
		n += 16
	}
	if x >= 1<<8 {
		x >>= 8
		n += 8
	}
	return n + len8(uint32(x))
}

// --- Add with carry ---

// Add returns the sum with carry of x, y and carry: sum = x + y + carry.
// The carry input must be 0 or 1; otherwise the behavior is undefined.
// The carryOut output is guaranteed to be 0 or 1.
func Add(x, y, carry uint) (sum, carryOut uint) {
	s64, c64 := Add64(uint64(x), uint64(y), uint64(carry))
	return uint(s64), uint(c64)
}

// Add32 returns the sum with carry of x, y and carry: sum = x + y + carry.
func Add32(x, y, carry uint32) (sum, carryOut uint32) {
	sum64 := uint64(x) + uint64(y) + uint64(carry)
	sum = uint32(sum64)
	carryOut = uint32(sum64 >> 32)
	return
}

// Add64 returns the sum with carry of x, y and carry: sum = x + y + carry.
func Add64(x, y, carry uint64) (sum, carryOut uint64) {
	sum = x + y + carry
	carryOut = ((x & y) | ((x | y) &^ sum)) >> 63
	return
}

// --- Subtract with borrow ---

// Sub returns the difference of x, y and borrow: diff = x - y - borrow.
// The borrow input must be 0 or 1; otherwise the behavior is undefined.
// The borrowOut output is guaranteed to be 0 or 1.
func Sub(x, y, borrow uint) (diff, borrowOut uint) {
	d64, b64 := Sub64(uint64(x), uint64(y), uint64(borrow))
	return uint(d64), uint(b64)
}

// Sub32 returns the difference of x, y and borrow, diff = x - y - borrow.
func Sub32(x, y, borrow uint32) (diff, borrowOut uint32) {
	diff = x - y - borrow
	borrowOut = ((^x & y) | (^(x ^ y) & diff)) >> 31
	return
}

// Sub64 returns the difference of x, y and borrow: diff = x - y - borrow.
func Sub64(x, y, borrow uint64) (diff, borrowOut uint64) {
	diff = x - y - borrow
	borrowOut = ((^x & y) | (^(x ^ y) & diff)) >> 63
	return
}

// --- Full-width multiply ---

// Mul returns the full-width product of x and y: (hi, lo) = x * y
// with the product bits' upper half returned in hi and the lower
// half returned in lo.
func Mul(x, y uint) (hi, lo uint) {
	h, l := Mul64(uint64(x), uint64(y))
	return uint(h), uint(l)
}

// Mul32 returns the 64-bit product of x and y: (hi, lo) = x * y
// with the product bits' upper half returned in hi and the lower
// half returned in lo.
func Mul32(x, y uint32) (hi, lo uint32) {
	tmp := uint64(x) * uint64(y)
	hi, lo = uint32(tmp>>32), uint32(tmp)
	return
}

// Mul64 returns the 128-bit product of x and y: (hi, lo) = x * y
// with the product bits' upper half returned in hi and the lower
// half returned in lo.
func Mul64(x, y uint64) (hi, lo uint64) {
	// Literals, not a local constant: JS output of a local untyped constant
	// used as a uint64 operand names a BigInt variable it never declares.
	x0 := x & 0xffffffff
	x1 := x >> 32
	y0 := y & 0xffffffff
	y1 := y >> 32
	w0 := x0 * y0
	t := x1*y0 + w0>>32
	w1 := t & 0xffffffff
	w2 := t >> 32
	w1 += x0 * y1
	hi = x1*y1 + w2 + w1>>32
	lo = x * y
	return
}

// --- Full-width divide ---

// Div returns the quotient and remainder of (hi, lo) divided by y:
// quo = (hi, lo)/y, rem = (hi, lo)%y with the dividend bits' upper
// half in parameter hi and the lower half in parameter lo.
// Div panics for y == 0 (division by zero) or y <= hi (quotient overflow).
func Div(hi, lo, y uint) (quo, rem uint) {
	q, r := Div64(uint64(hi), uint64(lo), uint64(y))
	return uint(q), uint(r)
}

// Div32 returns the quotient and remainder of (hi, lo) divided by y.
// Div32 panics for y == 0 (division by zero) or y <= hi (quotient overflow).
func Div32(hi, lo, y uint32) (quo, rem uint32) {
	if y != 0 && y <= hi {
		panic(overflowError)
	}
	z := uint64(hi)<<32 | uint64(lo)
	quo, rem = uint32(z/uint64(y)), uint32(z%uint64(y))
	return
}

// Div64 returns the quotient and remainder of (hi, lo) divided by y.
// Div64 panics for y == 0 (division by zero) or y <= hi (quotient overflow).
func Div64(hi, lo, y uint64) (quo, rem uint64) {
	if y == 0 {
		panic(divideError)
	}
	if y <= hi {
		panic(overflowError)
	}

	// If high part is zero, we can directly return the results.
	if hi == 0 {
		return lo / y, lo % y
	}

	s := uint(LeadingZeros64(y))
	y <<= s

	// two32 is 1<<32 (see Mul64 on why it is a variable).
	var two32 uint64 = 1 << 32
	yn1 := y >> 32
	yn0 := y & 0xffffffff
	un32 := hi<<s | lo>>(64-s)
	un10 := lo << s
	un1 := un10 >> 32
	un0 := un10 & 0xffffffff
	q1 := un32 / yn1
	rhat := un32 - q1*yn1

	for q1 >= two32 || q1*yn0 > two32*rhat+un1 {
		q1--
		rhat += yn1
		if rhat >= two32 {
			break
		}
	}

	un21 := un32*two32 + un1 - q1*y
	q0 := un21 / yn1
	rhat = un21 - q0*yn1

	for q0 >= two32 || q0*yn0 > two32*rhat+un0 {
		q0--
		rhat += yn1
		if rhat >= two32 {
			break
		}
	}

	return q1*two32 + q0, (un21*two32 + un0 - q0*y) >> s
}

// Rem returns the remainder of (hi, lo) divided by y. Rem panics for
// y == 0 (division by zero) but, unlike Div, it doesn't panic on a
// quotient overflow.
func Rem(hi, lo, y uint) uint {
	return uint(Rem64(uint64(hi), uint64(lo), uint64(y)))
}

// Rem32 returns the remainder of (hi, lo) divided by y. Rem32 panics
// for y == 0 (division by zero) but, unlike Div32, it doesn't panic
// on a quotient overflow.
func Rem32(hi, lo, y uint32) uint32 {
	return uint32((uint64(hi)<<32 | uint64(lo)) % uint64(y))
}

// Rem64 returns the remainder of (hi, lo) divided by y. Rem64 panics
// for y == 0 (division by zero) but, unlike Div64, it doesn't panic
// on a quotient overflow.
func Rem64(hi, lo, y uint64) uint64 {
	// We scale down hi so that hi < y, then use Div64 to compute the
	// rem with the guarantee that it won't panic on quotient overflow.
	// Given that
	//   hi ≡ hi%y    (mod y)
	// we have
	//   hi<<64 + lo ≡ (hi%y)<<64 + lo    (mod y)
	_, rem := Div64(hi%y, lo, y)
	return rem
}
