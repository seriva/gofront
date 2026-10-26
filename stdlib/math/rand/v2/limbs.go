//go:build gofront

//gofront:target both

package rand

// Go's generators work on uint64, which is a JavaScript Number here and exact
// only up to 2^53. The generators below therefore keep every 64-bit value as
// two uint32 halves, so the sequence from a given seed is the same on both
// backends and matches Go. Only a value that is returned as a uint64 (Uint64,
// Int64, Int, ...) can lose low bits in JavaScript once it exceeds 2^53.

// u64 is a 64-bit unsigned integer as two 32-bit halves.
type u64 struct {
	hi uint32
	lo uint32
}

func fromUint64(x uint64) u64 {
	return u64{uint32(x >> 32), uint32(x)}
}

func (x u64) uint64() uint64 {
	return uint64(x.hi)*4294967296 + uint64(x.lo)
}

// mul32 returns the 64-bit product of a and b.
func mul32(a, b uint32) (hi uint32, lo uint32) {
	a0, a1 := a&0xffff, a>>16
	b0, b1 := b&0xffff, b>>16
	w0 := a0 * b0
	t := a1*b0 + w0>>16
	w1 := t & 0xffff
	w2 := t >> 16
	w1 += a0 * b1
	hi = a1*b1 + w2 + w1>>16
	lo = a * b
	return hi, lo
}

// addc returns a+b and the carry out.
func addc(a, b uint32) (sum uint32, carry uint32) {
	sum = a + b
	if sum < a {
		carry = 1
	}
	return sum, carry
}

// add64 returns x+y modulo 2^64 and the carry out.
func add64(x, y u64) (z u64, carry uint32) {
	lo, c0 := addc(x.lo, y.lo)
	h1, c1 := addc(x.hi, y.hi)
	hi, c2 := addc(h1, c0)
	return u64{hi, lo}, c1 + c2
}

// sub64 returns x-y modulo 2^64.
func sub64(x, y u64) u64 {
	lo := x.lo - y.lo
	hi := x.hi - y.hi
	if x.lo < y.lo {
		hi--
	}
	return u64{hi, lo}
}

func less64(x, y u64) bool {
	return x.hi < y.hi || (x.hi == y.hi && x.lo < y.lo)
}

// mul64 returns the 128-bit product of x and y.
func mul64(x, y u64) (hi u64, lo u64) {
	a1, a0 := mul32(x.lo, y.lo)
	b1, b0 := mul32(x.hi, y.lo)
	c1, c0 := mul32(x.lo, y.hi)
	d1, d0 := mul32(x.hi, y.hi)
	s1, k1 := addc(a1, b0)
	r1, k2 := addc(s1, c0)
	s2, k3 := addc(b1, c1)
	s3, k4 := addc(s2, d0)
	r2, k5 := addc(s3, k1+k2)
	r3 := d1 + k3 + k4 + k5
	return u64{r3, r2}, u64{r1, a0}
}

// mulLow64 returns the low 64 bits of x*y.
func mulLow64(x, y u64) u64 {
	_, lo := mul64(x, y)
	return lo
}

// negMod returns -n % n computed in 64-bit arithmetic, which is 2^64 mod n.
func negMod(n u64) u64 {
	var r u64
	for i := 0; i < 65; i++ {
		top := r.hi >> 31
		r = u64{r.hi<<1 | r.lo>>31, r.lo << 1}
		if i == 0 {
			r.lo |= 1
		}
		if top != 0 || !less64(r, n) {
			r = sub64(r, n)
		}
	}
	return r
}
