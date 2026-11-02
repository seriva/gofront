//go:build gofront

//gofront:target both

// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Package rand implements pseudo-random number generators.
//
// The top-level functions draw from the host's random source and are not
// reproducible; Seed is a no-op. A generator made with New(NewSource(seed))
// is deterministic for a seed, but its sequence is not the one Go's
// generator produces.
package rand

// A Source represents a source of pseudo-random int64 values in [0, 1<<63).
type Source interface {
	Int63() int64
	Seed(seed int64)
}

// A Source64 is a Source that can also generate uniformly-distributed
// pseudo-random uint64 values in [0, 1<<64) directly.
type Source64 interface {
	Source
	Uint64() uint64
}

// hostFloat returns a uniformly distributed float64 in [0, 1) from the host.
//
//gofront:intrinsic rand_source
func hostFloat() float64

// hostSource is the Source behind the top-level functions.
type hostSource struct{}

func (hostSource) Uint64() uint64 {
	hi := uint64(hostFloat() * (1 << 32))
	lo := uint64(hostFloat() * (1 << 32))
	return hi<<32 | lo
}

func (s hostSource) Int63() int64 { return int64(s.Uint64() >> 1) }

func (hostSource) Seed(seed int64) {}

var host Source = hostSource{}

// splitMix is a SplitMix64 generator, the Source behind NewSource.
type splitMix struct {
	state uint64
}

func (s *splitMix) Uint64() uint64 {
	// Variables, not constants: JS output of a typed 64-bit constant above
	// 2^53 is a Number.
	var gamma, mul1, mul2 uint64 = 0x9e3779b97f4a7c15, 0xbf58476d1ce4e5b9, 0x94d049bb133111eb
	s.state += gamma
	z := s.state
	z = (z ^ (z >> 30)) * mul1
	z = (z ^ (z >> 27)) * mul2
	return z ^ (z >> 31)
}

func (s *splitMix) Int63() int64 { return int64(s.Uint64() >> 1) }

func (s *splitMix) Seed(seed int64) { s.state = uint64(seed) }

// NewSource returns a new pseudo-random Source seeded with the given value.
func NewSource(seed int64) Source {
	return &splitMix{state: uint64(seed)}
}

// A Rand is a source of random numbers.
type Rand struct {
	src Source
	s64 Source64 // non-nil if src is source64

	// readVal contains remainder of 63-bit integer used for bytes
	// generation during Read; readPos is the number of bytes left in it.
	readVal int64
	readPos int8
}

// New returns a new Rand that uses random values from src to generate other
// random values.
func New(src Source) *Rand {
	s64, _ := src.(Source64)
	return &Rand{src: src, s64: s64}
}

// Seed uses the provided seed value to initialize the generator to a
// deterministic state.
func (r *Rand) Seed(seed int64) {
	r.src.Seed(seed)
	r.readPos = 0
}

// Int63 returns a non-negative pseudo-random 63-bit integer as an int64.
func (r *Rand) Int63() int64 { return r.src.Int63() }

// Uint32 returns a pseudo-random 32-bit value as a uint32.
func (r *Rand) Uint32() uint32 { return uint32(r.Int63() >> 31) }

// Uint64 returns a pseudo-random 64-bit value as a uint64.
func (r *Rand) Uint64() uint64 {
	if r.s64 != nil {
		return r.s64.Uint64()
	}
	return uint64(r.Int63())>>31 | uint64(r.Int63())<<32
}

// Int31 returns a non-negative pseudo-random 31-bit integer as an int32.
func (r *Rand) Int31() int32 { return int32(r.Int63() >> 32) }

// Int returns a non-negative pseudo-random int.
func (r *Rand) Int() int {
	u := uint(r.Int63())
	return int(u << 1 >> 1)
}

// Int63n returns, as an int64, a non-negative pseudo-random number in the
// half-open interval [0,n). It panics if n <= 0.
func (r *Rand) Int63n(n int64) int64 {
	if n <= 0 {
		panic("invalid argument to Int63n")
	}
	if n&(n-1) == 0 { // n is power of two, can mask
		return r.Int63() & (n - 1)
	}
	// A typed variable: an untyped left operand of % is signed in WASM, and
	// JS output of a typed constant above 2^53 is a Number.
	var half uint64 = 1 << 63
	max := int64(half - 1 - half%uint64(n))
	v := r.Int63()
	for v > max {
		v = r.Int63()
	}
	return v % n
}

// Int31n returns, as an int32, a non-negative pseudo-random number in the
// half-open interval [0,n). It panics if n <= 0.
func (r *Rand) Int31n(n int32) int32 {
	if n <= 0 {
		panic("invalid argument to Int31n")
	}
	if n&(n-1) == 0 { // n is power of two, can mask
		return r.Int31() & (n - 1)
	}
	const half uint32 = 1 << 31 // typed: an untyped left operand of % is signed in WASM
	max := int32(half - 1 - half%uint32(n))
	v := r.Int31()
	for v > max {
		v = r.Int31()
	}
	return v % n
}

// Intn returns, as an int, a non-negative pseudo-random number in the
// half-open interval [0,n). It panics if n <= 0.
func (r *Rand) Intn(n int) int {
	if n <= 0 {
		panic("invalid argument to Intn")
	}
	if n <= 1<<31-1 {
		return int(r.Int31n(int32(n)))
	}
	return int(r.Int63n(int64(n)))
}

// Float64 returns, as a float64, a pseudo-random number in the half-open
// interval [0.0,1.0).
func (r *Rand) Float64() float64 {
	for {
		f := float64(r.Int63n(1<<53)) / (1 << 53)
		if f != 1 {
			return f
		}
	}
}

// Float32 returns, as a float32, a pseudo-random number in the half-open
// interval [0.0,1.0).
func (r *Rand) Float32() float32 {
	for {
		f := float32(r.Float64())
		if f != 1 {
			return f
		}
	}
}

// Perm returns, as a slice of n ints, a pseudo-random permutation of the
// integers in the half-open interval [0,n).
func (r *Rand) Perm(n int) []int {
	if n < 0 {
		// make([]int, n) panics like this; JS output of make does not check.
		panic("runtime error: makeslice: len out of range")
	}
	m := make([]int, n)
	for i := 0; i < n; i++ {
		j := r.Intn(i + 1)
		m[i] = m[j]
		m[j] = i
	}
	return m
}

// Shuffle pseudo-randomizes the order of elements. n is the number of
// elements. Shuffle panics if n < 0. swap swaps the elements with indexes i
// and j.
func (r *Rand) Shuffle(n int, swap func(i, j int)) {
	if n < 0 {
		panic("invalid argument to Shuffle")
	}
	for i := n - 1; i > 0; i-- {
		j := int(r.Int63n(int64(i + 1)))
		swap(i, j)
	}
}

// Read generates len(p) random bytes and writes them into p. It always
// returns len(p) and a nil error.
func (r *Rand) Read(p []byte) (n int, err error) {
	pos := r.readPos
	val := r.readVal
	for n = 0; n < len(p); n++ {
		if pos == 0 {
			val = r.Int63()
			pos = 7
		}
		p[n] = byte(val)
		val >>= 8
		pos--
	}
	r.readPos = pos
	r.readVal = val
	return
}

// The top-level functions draw from the host source through a Rand that
// holds no state of its own.

func hostRand() *Rand { return &Rand{src: host} }

// Seed does nothing: the top-level functions always draw from the host.
func Seed(seed int64) {}

// Int63 returns a non-negative pseudo-random 63-bit integer as an int64.
func Int63() int64 { return host.Int63() }

// Uint32 returns a pseudo-random 32-bit value as a uint32.
func Uint32() uint32 { return hostRand().Uint32() }

// Uint64 returns a pseudo-random 64-bit value as a uint64.
func Uint64() uint64 { return hostSource{}.Uint64() }

// Int31 returns a non-negative pseudo-random 31-bit integer as an int32.
func Int31() int32 { return hostRand().Int31() }

// Int returns a non-negative pseudo-random int.
func Int() int { return hostRand().Int() }

// Int63n returns, as an int64, a non-negative pseudo-random number in the
// half-open interval [0,n). It panics if n <= 0.
func Int63n(n int64) int64 { return hostRand().Int63n(n) }

// Int31n returns, as an int32, a non-negative pseudo-random number in the
// half-open interval [0,n). It panics if n <= 0.
func Int31n(n int32) int32 { return hostRand().Int31n(n) }

// Intn returns, as an int, a non-negative pseudo-random number in the
// half-open interval [0,n). It panics if n <= 0.
func Intn(n int) int { return hostRand().Intn(n) }

// Float64 returns, as a float64, a pseudo-random number in the half-open
// interval [0.0,1.0).
func Float64() float64 { return hostRand().Float64() }

// Float32 returns, as a float32, a pseudo-random number in the half-open
// interval [0.0,1.0).
func Float32() float32 { return hostRand().Float32() }

// Perm returns, as a slice of n ints, a pseudo-random permutation of the
// integers in the half-open interval [0,n).
func Perm(n int) []int { return hostRand().Perm(n) }

// Shuffle pseudo-randomizes the order of elements. n is the number of
// elements. Shuffle panics if n < 0. swap swaps the elements with indexes i
// and j.
func Shuffle(n int, swap func(i, j int)) { hostRand().Shuffle(n, swap) }

// Read generates len(p) random bytes and writes them into p. It always
// returns len(p) and a nil error.
func Read(p []byte) (n int, err error) { return hostRand().Read(p) }
