// GoFront test suite — math/rand and crypto/rand (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.  Values from the
// host source differ between runs, so the programs print only properties
// that hold for every draw.

import { assertFourWay, section, test } from "../helpers.js";

section("math/rand (Go-source)");

test("draws stay in range", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"math/rand"
)

func main() {
	ok := true
	for i := 0; i < 2000; i++ {
		n := rand.Intn(10)
		ok = ok && n >= 0 && n < 10
		big := rand.Intn(1 << 40)
		ok = ok && big >= 0 && big < 1<<40
		i31 := rand.Int31n(7)
		ok = ok && i31 >= 0 && i31 < 7
		i63 := rand.Int63n(1000000007)
		ok = ok && i63 >= 0 && i63 < 1000000007
		f := rand.Float64()
		ok = ok && f >= 0 && f < 1
		g := rand.Float32()
		ok = ok && g >= 0 && g < 1
		ok = ok && rand.Int() >= 0 && rand.Int31() >= 0 && rand.Int63() >= 0
	}
	fmt.Println(ok)
	var u32 uint32 = rand.Uint32()
	var u64 uint64 = rand.Uint64()
	_, _ = u32, u64
	rand.Seed(42)
	fmt.Println(rand.Intn(1) == 0, rand.Int63n(1) == 0, rand.Int31n(1) == 0)
	seen := map[int]bool{}
	for i := 0; i < 500; i++ {
		seen[rand.Intn(5)] = true
	}
	fmt.Println(len(seen))
}
`,
		`true
true true true
5
`,
	);
});

test("Perm is a permutation and Shuffle keeps the multiset", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"math/rand"
	"sort"
)

func main() {
	for _, n := range []int{0, 1, 2, 10, 100} {
		p := rand.Perm(n)
		seen := make([]bool, n)
		ok := len(p) == n
		for _, v := range p {
			ok = ok && v >= 0 && v < n && !seen[v]
			if v >= 0 && v < n {
				seen[v] = true
			}
		}
		fmt.Println(n, ok)
	}
	s := []int{5, 3, 3, 9, 1, 1, 1, 7}
	rand.Shuffle(len(s), func(i, j int) { s[i], s[j] = s[j], s[i] })
	sort.Ints(s)
	fmt.Println(s)
	words := []string{"a", "b", "c", "d"}
	rand.Shuffle(len(words), func(i, j int) { words[i], words[j] = words[j], words[i] })
	sort.Strings(words)
	fmt.Println(words)
	rand.Shuffle(0, func(i, j int) { panic("no swaps") })
	rand.Shuffle(1, func(i, j int) { panic("no swaps") })
}
`,
		`0 true
1 true
2 true
10 true
100 true
[1 1 1 3 3 5 7 9]
[a b c d]
`,
	);
});

test("a seeded Rand repeats itself and Read fills the buffer", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"math/rand"
)

func main() {
	a := rand.New(rand.NewSource(7))
	b := rand.New(rand.NewSource(7))
	same := true
	for i := 0; i < 100; i++ {
		same = same && a.Int63() == b.Int63() && a.Intn(1000) == b.Intn(1000)
	}
	fmt.Println(same)
	c := rand.New(rand.NewSource(8))
	a.Seed(8)
	fmt.Println(a.Int63() == c.Int63(), a.Float64() == c.Float64())
	p := a.Perm(6)
	fmt.Println(len(p), a.Intn(3) < 3, a.Uint32() >= 0)

	buf := make([]byte, 64)
	n, err := rand.Read(buf)
	fmt.Println(n, err)
	zeros := 0
	for _, v := range buf {
		if v == 0 {
			zeros++
		}
	}
	fmt.Println(zeros < 64)
	n, err = a.Read(buf[:5])
	fmt.Println(n, err)
}
`,
		`true
true true
6 true true
64 <nil>
true
5 <nil>
`,
	);
});

test("invalid arguments panic with Go's messages", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"math/rand"
)

func try(name string, f func()) {
	defer func() { fmt.Println(name, recover()) }()
	f()
}

func main() {
	try("Intn", func() { rand.Intn(0) })
	try("Intn neg", func() { rand.Intn(-5) })
	try("Int63n", func() { rand.Int63n(0) })
	try("Int31n", func() { rand.Int31n(-1) })
	try("Shuffle", func() { rand.Shuffle(-1, func(i, j int) {}) })
	try("Perm", func() { rand.Perm(-1) })
	r := rand.New(rand.NewSource(1))
	try("Rand.Intn", func() { r.Intn(0) })
}
`,
		`Intn invalid argument to Intn
Intn neg invalid argument to Intn
Int63n invalid argument to Int63n
Int31n invalid argument to Int31n
Shuffle invalid argument to Shuffle
Perm runtime error: makeslice: len out of range
Rand.Intn invalid argument to Intn
`,
	);
});

section("crypto/rand (Go-source)");

test("Read fills the buffer for every length and reports it", async () => {
	await assertFourWay(
		`package main

import (
	"crypto/rand"
	"fmt"
	"io"
)

func main() {
	for _, n := range []int{0, 1, 3, 4, 5, 7, 8, 1000, 70000} {
		b := make([]byte, n)
		got, err := rand.Read(b)
		fmt.Println(n, got, err)
	}
	n, err := rand.Read(nil)
	fmt.Println(n, err)
	// 64 random bytes are all zero with probability 2^-512.
	b := make([]byte, 64)
	rand.Read(b)
	zero := true
	for _, c := range b {
		zero = zero && c == 0
	}
	fmt.Println(zero)
	// A short buffer is filled up to its length and no further.
	big := make([]byte, 10)
	rand.Read(big[:3])
	fmt.Println(big[3:])
	var r io.Reader = rand.Reader
	m, err := io.ReadFull(r, make([]byte, 9))
	fmt.Println(m, err)
}
`,
		`0 0 <nil>
1 1 <nil>
3 3 <nil>
4 4 <nil>
5 5 <nil>
7 7 <nil>
8 8 <nil>
1000 1000 <nil>
70000 70000 <nil>
0 <nil>
false
[0 0 0 0 0 0 0]
9 <nil>
`,
	);
});

test("math/rand and crypto/rand can be imported together", async () => {
	await assertFourWay(
		`package main

import (
	crand "crypto/rand"
	"fmt"
	"math/rand"
)

func main() {
	b := make([]byte, 4)
	n, err := crand.Read(b)
	fmt.Println(n, err, rand.Intn(1) == 0)
}
`,
		`4 <nil> true
`,
	);
});
