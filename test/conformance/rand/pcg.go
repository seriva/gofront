package main

import (
	"fmt"
	"math"
	"math/rand/v2"
)

func main() {
	// Uint64 values above 2^53 are inexact on JavaScript, so read the halves
	// of each output through Uint32 (high) and Uint64N(1<<32) (low).
	hi := rand.New(rand.NewPCG(1, 2))
	lo := rand.New(rand.NewPCG(1, 2))
	for i := 0; i < 6; i++ {
		fmt.Printf("pcg %d: hi=%d lo=%d\n", i, hi.Uint32(), lo.Uint64N(1<<32))
	}
	p := rand.NewPCG(1, 2)

	r := rand.New(rand.NewPCG(1, 2))
	fmt.Printf("Uint32: %d %d %d\n", r.Uint32(), r.Uint32(), r.Uint32())
	fmt.Println("Int32:", r.Int32(), r.Int32())
	fmt.Println("IntN(10):", r.IntN(10), r.IntN(10), r.IntN(10), r.IntN(10), r.IntN(10))
	fmt.Println("IntN(1000):", r.IntN(1000), r.IntN(1000), r.IntN(1000))
	fmt.Println("IntN(1<<20):", r.IntN(1<<20), r.IntN(1<<20))
	fmt.Println("Int64N(1<<40):", r.Int64N(1<<40), r.Int64N(1<<40))
	fmt.Println("Uint64N(1e15):", r.Uint64N(1000000000000000), r.Uint64N(1000000000000000))
	fmt.Printf("Int32N: %d %d %d %d\n", r.Int32N(100), r.Int32N(7), r.Uint32N(1<<31), r.Uint32N(5))
	fmt.Println("UintN:", r.UintN(1000), r.UintN(64))
	fmt.Printf("Float64: %.17g %.17g %.17g\n", r.Float64(), r.Float64(), r.Float64())
	fmt.Printf("Float32: %.9g %.9g\n", r.Float32(), r.Float32())
	fmt.Println("Perm:", r.Perm(8), r.Perm(5))
	xs := []string{"a", "b", "c", "d", "e", "f"}
	r.Shuffle(len(xs), func(i, j int) { xs[i], xs[j] = xs[j], xs[i] })
	fmt.Println("Shuffle:", xs)
	fmt.Printf("Norm: %.15g %.15g %.15g %.15g\n", r.NormFloat64(), r.NormFloat64(), r.NormFloat64(), r.NormFloat64())
	fmt.Printf("Exp: %.15g %.15g %.15g %.15g\n", r.ExpFloat64(), r.ExpFloat64(), r.ExpFloat64(), r.ExpFloat64())

	// Seeds with the high bits set.
	q := rand.New(rand.NewPCG(1<<40+12345, 987654321098))
	fmt.Printf("seeded: %d %d %d\n", q.Uint32(), q.IntN(100), q.Uint32N(1000000))

	// Resetting and marshaling.
	p.Seed(1, 2)
	a := p.Uint64()
	p.Seed(1, 2)
	fmt.Println("reseed:", a == p.Uint64())
	p.Seed(1, 2)
	p.Uint64()
	data, err := p.MarshalBinary()
	fmt.Printf("marshal: %x %v\n", data, err)
	var p2 rand.PCG
	fmt.Println("unmarshal:", p2.UnmarshalBinary(data), p2.Uint64() == p.Uint64())
	fmt.Println("bad:", p2.UnmarshalBinary([]byte("pcg:short")))

	z := rand.NewZipf(rand.New(rand.NewPCG(3, 4)), 1.5, 2, 100)
	fmt.Println("Zipf:", z.Uint64(), z.Uint64(), z.Uint64(), z.Uint64(), z.Uint64())
	fmt.Println("Zipf nil:", rand.NewZipf(r, 1, 2, 10) == nil)

	// The top-level functions are random: check ranges only.
	ok := true
	for i := 0; i < 1000; i++ {
		ok = ok && rand.IntN(10) < 10 && rand.Int64N(1<<45) < 1<<45 && rand.Float64() < 1 && rand.Float32() < 1
		ok = ok && rand.N(100) < 100 && rand.N(int64(7)) < 7 && rand.Uint32N(9) < 9
		ok = ok && rand.Int() >= 0 && rand.Int32() >= 0 && rand.Int64() >= 0
		ok = ok && !math.IsNaN(rand.NormFloat64()) && rand.ExpFloat64() > 0
	}
	perm := rand.Perm(10)
	seen := map[int]bool{}
	for _, v := range perm {
		seen[v] = true
	}
	fmt.Println("top-level:", ok, len(perm), len(seen))
	rand.Shuffle(3, func(i, j int) {})
	_ = rand.Uint64()
	_ = rand.Uint32()
	_ = rand.Uint()
	_ = rand.UintN(5)
	_ = rand.Uint64N(9)
	_ = rand.Int32N(9)

	// A Source of your own.
	c := rand.New(&counter{})
	fmt.Printf("custom: %d %d %d\n", c.Uint32(), c.IntN(10), c.Uint32())
}

type counter struct{ n uint64 }

func (c *counter) Uint64() uint64 {
	c.n++
	return c.n * 0x100000001
}
