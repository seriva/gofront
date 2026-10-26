//go:build gofront

//gofront:target both

// Package rand implements pseudo-random number generators suitable for tasks
// such as simulation, but it should not be used for security-sensitive work.
//
// The PCG source gives Go's exact sequence for a given seed on both backends.
// A Source of your own is exact in WebAssembly; in JavaScript its Uint64 values
// above 2^53 lose their low bits. ChaCha8 is not provided. The top-level
// functions use a PCG seeded from the platform's random source.
package rand

import "math/rand"

// A Source is a source of uniformly-distributed pseudo-random uint64 values
// in the range [0, 1<<64).
type Source interface {
	Uint64() uint64
}

// A Rand is a source of random numbers.
type Rand struct {
	src Source
}

// New returns a new Rand that uses random values from src to generate other
// random values.
func New(src Source) *Rand {
	return &Rand{src: src}
}

// next64 returns the next 64 random bits as two halves.
func (r *Rand) next64() u64 {
	if p, ok := r.src.(*PCG); ok {
		return p.next64()
	}
	return fromUint64(r.src.Uint64())
}

// Int64 returns a non-negative pseudo-random 63-bit integer as an int64.
func (r *Rand) Int64() int64 {
	x := r.next64()
	return int64(x.hi&0x7fffffff)*4294967296 + int64(x.lo)
}

// Uint32 returns a pseudo-random 32-bit value as a uint32.
func (r *Rand) Uint32() uint32 { return r.next64().hi }

// Uint64 returns a pseudo-random 64-bit value as a uint64.
func (r *Rand) Uint64() uint64 { return r.next64().uint64() }

// Int32 returns a non-negative pseudo-random 31-bit integer as an int32.
func (r *Rand) Int32() int32 { return int32(r.next64().hi >> 1) }

// Int returns a non-negative pseudo-random int.
func (r *Rand) Int() int { return int(r.Int64()) }

// Uint returns a pseudo-random uint.
func (r *Rand) Uint() uint { return uint(r.Uint64()) }

// Int64N returns, as an int64, a non-negative pseudo-random number in the
// half-open interval [0,n). It panics if n <= 0.
func (r *Rand) Int64N(n int64) int64 {
	if n <= 0 {
		panic("invalid argument to Int64N")
	}
	return int64(r.uint64n(uint64(n)))
}

// Uint64N returns, as a uint64, a non-negative pseudo-random number in the
// half-open interval [0,n). It panics if n == 0.
func (r *Rand) Uint64N(n uint64) uint64 {
	if n == 0 {
		panic("invalid argument to Uint64N")
	}
	return r.uint64n(n)
}

// uint64n is the no-bounds-checks version of Uint64N.
func (r *Rand) uint64n(n uint64) uint64 {
	return r.uint64nPair(fromUint64(n)).uint64()
}

func (r *Rand) uint64nPair(n u64) u64 {
	m := sub64(n, u64{0, 1})
	if n.hi&m.hi == 0 && n.lo&m.lo == 0 { // n is power of two, can mask
		x := r.next64()
		return u64{x.hi & m.hi, x.lo & m.lo}
	}

	// Multiply by n and keep the high word of the 128-bit product, redrawing
	// when the low word falls in the biased range.
	hi, lo := mul64(r.next64(), n)
	if less64(lo, n) {
		thresh := negMod(n)
		for less64(lo, thresh) {
			hi, lo = mul64(r.next64(), n)
		}
	}
	return hi
}

// Int32N returns, as an int32, a non-negative pseudo-random number in the
// half-open interval [0,n). It panics if n <= 0.
func (r *Rand) Int32N(n int32) int32 {
	if n <= 0 {
		panic("invalid argument to Int32N")
	}
	return int32(r.uint64n(uint64(n)))
}

// Uint32N returns, as a uint32, a non-negative pseudo-random number in the
// half-open interval [0,n). It panics if n == 0.
func (r *Rand) Uint32N(n uint32) uint32 {
	if n == 0 {
		panic("invalid argument to Uint32N")
	}
	return uint32(r.uint64n(uint64(n)))
}

// IntN returns, as an int, a non-negative pseudo-random number in the
// half-open interval [0,n). It panics if n <= 0.
func (r *Rand) IntN(n int) int {
	if n <= 0 {
		panic("invalid argument to IntN")
	}
	return int(r.uint64n(uint64(n)))
}

// UintN returns, as a uint, a non-negative pseudo-random number in the
// half-open interval [0,n). It panics if n == 0.
func (r *Rand) UintN(n uint) uint {
	if n == 0 {
		panic("invalid argument to UintN")
	}
	return uint(r.uint64n(uint64(n)))
}

// Float64 returns, as a float64, a pseudo-random number in the half-open
// interval [0.0,1.0).
func (r *Rand) Float64() float64 {
	x := r.next64()
	// There are exactly 1<<53 float64s in [0,1). Use Intn(1<<53) / (1<<53).
	return (float64(x.hi&0x1fffff)*4294967296 + float64(x.lo)) / (1 << 53)
}

// Float32 returns, as a float32, a pseudo-random number in the half-open
// interval [0.0,1.0).
func (r *Rand) Float32() float32 {
	// There are exactly 1<<24 float32s in [0,1). Use Intn(1<<24) / (1<<24).
	return float32(r.Uint32()&0xffffff) / (1 << 24)
}

// Perm returns, as a slice of n ints, a pseudo-random permutation of the
// integers in the half-open interval [0,n).
func (r *Rand) Perm(n int) []int {
	p := make([]int, n)
	for i := range p {
		p[i] = i
	}
	r.Shuffle(len(p), func(i, j int) { p[i], p[j] = p[j], p[i] })
	return p
}

// Shuffle pseudo-randomizes the order of elements.
// n is the number of elements. Shuffle panics if n < 0.
// swap swaps the elements with indexes i and j.
func (r *Rand) Shuffle(n int, swap func(i, j int)) {
	if n < 0 {
		panic("invalid argument to Shuffle")
	}

	// Fisher-Yates shuffle: https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
	// Shuffle really ought not be called with n that doesn't fit in 32 bits.
	// Not only will it take a very long time, but with 2³¹! possible permutations,
	// there's no way that any PRNG can have a big enough internal state to
	// generate even a minuscule percentage of the possible permutations.
	// Nevertheless, the right API signature accepts an int n, so handle it as best we can.
	for i := n - 1; i > 0; i-- {
		j := int(r.uint64n(uint64(i + 1)))
		swap(i, j)
	}
}

/*
 * Top-level convenience functions
 */

// globalRand is the source of the top-level functions: a PCG seeded from the
// platform's random source.
var globalRand = &Rand{src: NewPCG(randomSeed(), randomSeed())}

// randomSeed returns 52 random bits from the platform's random source.
func randomSeed() uint64 {
	return uint64(rand.Float64() * 4503599627370496)
}

// global returns the generator behind the top-level functions. A 'both'
// package may not call a pointer-receiver method on a package variable
// directly.
func global() *Rand { return globalRand }

// Int64 returns a non-negative pseudo-random 63-bit integer as an int64
// from the default Source.
func Int64() int64 { return global().Int64() }

// Uint32 returns a pseudo-random 32-bit value as a uint32
// from the default Source.
func Uint32() uint32 { return global().Uint32() }

// Uint64N returns, as a uint64, a pseudo-random number in the half-open
// interval [0,n) from the default Source.
// It panics if n == 0.
func Uint64N(n uint64) uint64 { return global().Uint64N(n) }

// Uint32N returns, as a uint32, a pseudo-random number in the half-open
// interval [0,n) from the default Source.
// It panics if n == 0.
func Uint32N(n uint32) uint32 { return global().Uint32N(n) }

// Uint64 returns a pseudo-random 64-bit value as a uint64
// from the default Source.
func Uint64() uint64 { return global().Uint64() }

// Int32 returns a non-negative pseudo-random 31-bit integer as an int32
// from the default Source.
func Int32() int32 { return global().Int32() }

// Int returns a non-negative pseudo-random int from the default Source.
func Int() int { return global().Int() }

// Uint returns a pseudo-random uint from the default Source.
func Uint() uint { return global().Uint() }

// Int64N returns, as an int64, a pseudo-random number in the half-open
// interval [0,n) from the default Source.
// It panics if n <= 0.
func Int64N(n int64) int64 { return global().Int64N(n) }

// Int32N returns, as an int32, a pseudo-random number in the half-open
// interval [0,n) from the default Source.
// It panics if n <= 0.
func Int32N(n int32) int32 { return global().Int32N(n) }

// IntN returns, as an int, a pseudo-random number in the half-open
// interval [0,n) from the default Source.
// It panics if n <= 0.
func IntN(n int) int { return global().IntN(n) }

// UintN returns, as a uint, a pseudo-random number in the half-open
// interval [0,n) from the default Source.
// It panics if n == 0.
func UintN(n uint) uint { return global().UintN(n) }

// N returns a pseudo-random number in the half-open interval [0,n) from the
// default Source. The type parameter Int can be any integer type. It panics if
// n <= 0.
func N[T intType](n T) T {
	if n <= 0 {
		panic("invalid argument to N")
	}
	return T(global().uint64n(uint64(n)))
}

type intType interface {
	~int | ~int8 | ~int16 | ~int32 | ~int64 |
		~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr
}

// Float64 returns a pseudo-random number in the half-open interval [0.0,1.0)
// from the default Source.
func Float64() float64 { return global().Float64() }

// Float32 returns a pseudo-random number in the half-open interval [0.0,1.0)
// from the default Source.
func Float32() float32 { return global().Float32() }

// Perm returns, as a slice of n ints, a pseudo-random permutation of the
// integers in the half-open interval [0,n) from the default Source.
func Perm(n int) []int { return global().Perm(n) }

// Shuffle pseudo-randomizes the order of elements using the default Source.
// n is the number of elements. Shuffle panics if n < 0.
// swap swaps the elements with indexes i and j.
func Shuffle(n int, swap func(i, j int)) { global().Shuffle(n, swap) }

// NormFloat64 returns a normally distributed float64 in the range
// [-math.MaxFloat64, +math.MaxFloat64] with standard normal distribution
// (mean = 0, stddev = 1) from the default Source.
func NormFloat64() float64 { return global().NormFloat64() }

// ExpFloat64 returns an exponentially distributed float64 in the range
// (0, +math.MaxFloat64] with an exponential distribution whose rate parameter
// (lambda) is 1 and whose mean is 1/lambda (1) from the default Source.
func ExpFloat64() float64 { return global().ExpFloat64() }
