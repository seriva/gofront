//go:build gofront

//gofront:target both

// Package subtle implements functions that are often useful in cryptographic
// code.
//
// The functions follow the same branch-free formulations as Go, but GoFront
// compiles to JavaScript and WebAssembly, so nothing here is hardened against
// timing or other side-channel attacks. Use Web Crypto (crypto.subtle) in
// `js` packages for real cryptography.
package subtle

// ConstantTimeCompare returns 1 if the two slices, x and y, have equal
// contents and 0 otherwise. If the lengths of x and y do not match it returns
// 0 immediately.
func ConstantTimeCompare(x, y []byte) int {
	if len(x) != len(y) {
		return 0
	}

	var v byte

	for i := 0; i < len(x); i++ {
		v |= x[i] ^ y[i]
	}

	return ConstantTimeByteEq(v, 0)
}

// ConstantTimeSelect returns x if v == 1 and y if v == 0.
// Its behavior is undefined if v takes any other value.
func ConstantTimeSelect(v, x, y int) int { return ^(v-1)&x | (v-1)&y }

// ConstantTimeByteEq returns 1 if x == y and 0 otherwise.
func ConstantTimeByteEq(x, y uint8) int {
	// Go uses 64-bit arithmetic here; the nonzero test below needs only 32 bits,
	// which keeps the result exact on the JavaScript backend.
	v := uint32(x ^ y)
	return int(1 ^ ((v | (^v + 1)) >> 31))
}

// ConstantTimeEq returns 1 if x == y and 0 otherwise.
func ConstantTimeEq(x, y int32) int {
	// Go uses 64-bit arithmetic here; the nonzero test below needs only 32 bits,
	// which keeps the result exact on the JavaScript backend.
	v := uint32(x ^ y)
	return int(1 ^ ((v | (^v + 1)) >> 31))
}

// ConstantTimeCopy copies the contents of y into x (a slice of equal length)
// if v == 1. If v == 0, x is left unchanged. Its behavior is undefined if v
// takes any other value.
func ConstantTimeCopy(v int, x, y []byte) {
	if len(x) != len(y) {
		panic("subtle: slices have different lengths")
	}

	xmask := byte(v - 1)
	ymask := byte(^(v - 1))
	for i := 0; i < len(x); i++ {
		x[i] = x[i]&xmask | y[i]&ymask
	}
}

// ConstantTimeLessOrEq returns 1 if x <= y and 0 otherwise.
// Its behavior is undefined if x or y are negative or > 2**31 - 1.
func ConstantTimeLessOrEq(x, y int) int {
	x32 := int32(x)
	y32 := int32(y)
	return int(uint32(x32-y32-1) >> 31)
}

// XORBytes sets dst[i] = x[i] ^ y[i] for all i < n = min(len(x), len(y)),
// returning n, the number of bytes written to dst.
// If dst does not have length at least n,
// XORBytes panics without writing anything to dst.
func XORBytes(dst, x, y []byte) int {
	n := min(len(x), len(y))
	if n == 0 {
		return 0
	}
	if n > len(dst) {
		panic("subtle.XORBytes: dst too short")
	}
	for i := 0; i < n; i++ {
		dst[i] = x[i] ^ y[i]
	}
	return n
}

// WithDataIndependentTiming runs f. There is no processor timing mode to
// toggle on JavaScript or WebAssembly, so it only calls f.
func WithDataIndependentTiming(f func()) {
	f()
}
