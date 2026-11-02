// GoFront test suite — sort (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import { assertFourWay, section, test } from "../helpers.js";

section("sort (Go-source)");

test("Float64s orders NaN first", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"math"
	"sort"
)

func main() {
	f := []float64{3, math.NaN(), 1, 2}
	sort.Float64s(f)
	fmt.Println(f, sort.Float64sAreSorted(f), sort.SearchFloat64s(f, 2))
	g := sort.Float64Slice{2, math.NaN(), 1}
	sort.Sort(g)
	fmt.Println(g, g.Search(1))
}
`,
		"[NaN 1 2 3] true 2\n[NaN 1 2] 1\n",
	);
});

test("Ints, Strings and nil slices", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"sort"
)

func main() {
	var n []int
	sort.Ints(n)
	sort.Strings(nil)
	sort.Float64s(nil)
	fmt.Println(n == nil, sort.IntsAreSorted(n), sort.StringsAreSorted(nil), sort.SearchInts(nil, 1))
	xs := []int{3, 1, 4, 1, 5, -9}
	sort.Ints(xs)
	s := []string{"pear", "apple", "fig"}
	sort.Strings(s)
	fmt.Println(xs, s, sort.IntsAreSorted(xs), sort.StringsAreSorted(s), sort.SearchInts(xs, 4), sort.SearchStrings(s, "g"))
	sub := []int{9, 8, 7, 6, 5}
	sort.Ints(sub[1:4])
	fmt.Println(sub)
	u := []uint8{3, 1, 2}
	sort.Sort(sort.Reverse(sort.IntSlice([]int{1, 2})))
	fmt.Println(u)
}
`,
		"true true true 0\n[-9 1 1 3 4 5] [apple fig pear] true true 4 2\n[9 6 7 8 5]\n[3 1 2]\n",
	);
});

test("Slice ties follow Go's pdqsort", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"sort"
)

func main() {
	xs := make([]int, 40)
	for i := range xs {
		xs[i] = i
	}
	sort.Slice(xs, func(i, j int) bool { return xs[i]%3 < xs[j]%3 })
	fmt.Println(xs)
	type P struct{ N, K int }
	for _, n := range []int{5, 13, 40, 1000} {
		ps := make([]P, n)
		for i := range ps {
			ps[i] = P{i, (i * 7) % 3}
		}
		sort.Slice(ps, func(i, j int) bool { return ps[i].K < ps[j].K })
		h := 0
		for _, p := range ps {
			h = (h*31 + p.N) % 1000003
		}
		fmt.Println(n, ps[:min(n, 8)], h, sort.SliceIsSorted(ps, func(i, j int) bool { return ps[i].K < ps[j].K }))
	}
}
`,
		"[15 39 36 3 33 30 6 27 24 9 0 21 12 18 10 4 16 1 13 19 37 34 22 31 28 25 7 14 8 29 5 23 32 26 11 35 2 20 38 17]\n5 [{0 0} {3 0} {1 1} {4 1} {2 2}] 90460 true\n13 [{6 0} {3 0} {0 0} {9 0} {12 0} {1 1} {4 1} {7 1}] 895110 true\n40 [{15 0} {39 0} {36 0} {3 0} {33 0} {30 0} {6 0} {27 0}] 554792 true\n1000 [{336 0} {999 0} {996 0} {3 0} {993 0} {990 0} {6 0} {987 0}] 420388 true\n",
	);
});

test("SliceStable and Stable keep equal elements in order", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"sort"
)

type P struct{ N, K int }

type byK []P

func (b byK) Len() int           { return len(b) }
func (b byK) Less(i, j int) bool { return b[i].K < b[j].K }
func (b byK) Swap(i, j int)      { b[i], b[j] = b[j], b[i] }

func main() {
	for _, n := range []int{5, 13, 40, 1000} {
		a := make([]P, n)
		for i := range a {
			a[i] = P{i, (i * 7) % 3}
		}
		b := append([]P(nil), a...)
		c := append([]P(nil), a...)
		sort.SliceStable(a, func(i, j int) bool { return a[i].K < a[j].K })
		sort.Stable(byK(b))
		sort.Sort(byK(c))
		ok := true
		for i := 1; i < n; i++ {
			if a[i-1].K == a[i].K && a[i-1].N > a[i].N {
				ok = false
			}
		}
		same := true
		for i := range a {
			if a[i] != b[i] {
				same = false
			}
		}
		h := 0
		for _, p := range c {
			h = (h*31 + p.N) % 1000003
		}
		fmt.Println(n, ok, same, c[:min(n, 6)], h)
	}
}
`,
		"5 true true [{0 0} {3 0} {1 1} {4 1} {2 2}] 90460\n13 true true [{6 0} {3 0} {0 0} {9 0} {12 0} {1 1}] 895110\n40 true true [{15 0} {39 0} {36 0} {3 0} {33 0} {30 0}] 554792\n1000 true true [{336 0} {999 0} {996 0} {3 0} {993 0} {990 0}] 420388\n",
	);
});

test("Interface, Reverse, IsSorted, Search and Find", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"sort"
)

func main() {
	var ps sort.IntSlice = []int{3, 1, 2}
	sort.Sort(sort.Reverse(ps))
	fmt.Println(ps, sort.IsSorted(ps), sort.IsSorted(sort.Reverse(ps)))
	ps.Sort()
	fmt.Println(ps, ps.Len(), ps.Search(2))
	ss := sort.StringSlice{"b", "a"}
	ss.Sort()
	fmt.Println(ss, ss.Search("b"))
	fmt.Println(sort.Search(10, func(i int) bool { return i*i >= 50 }), sort.Search(0, func(i int) bool { return true }))
	idx, found := sort.Find(3, func(i int) int { return 1 - i })
	idx2, found2 := sort.Find(3, func(i int) int { return 5 - i })
	fmt.Println(idx, found, idx2, found2)
	words := []string{"b", "d", "f"}
	fmt.Println(sort.SearchStrings(words, "a"), sort.SearchStrings(words, "d"), sort.SearchStrings(words, "z"))
}
`,
		"[3 2 1] false true\n[1 2 3] 3 1\n[a b] 1\n8 0\n1 true 3 false\n0 1 3\n",
	);
});

test("Slice with a named slice type and on a sub-slice", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"sort"
)

type Names []string

func main() {
	n := Names{"c", "a", "b"}
	sort.Slice(n, func(i, j int) bool { return n[i] < n[j] })
	fmt.Println(n)
	xs := []int{9, 8, 7, 6, 5, 4}
	sort.Slice(xs[1:5], func(i, j int) bool { return xs[1+i] < xs[1+j] })
	fmt.Println(xs)
	var nilS []int
	sort.Slice(nilS, func(i, j int) bool { return false })
	sort.SliceStable(nilS, func(i, j int) bool { return false })
	fmt.Println(sort.SliceIsSorted(nilS, func(i, j int) bool { return false }))
	type P struct {
		Name string
		Age  int
	}
	ps := []P{{"A", 30}, {"B", 25}, {"C", 30}, {"D", 25}}
	sort.SliceStable(ps, func(i, j int) bool { return ps[i].Age < ps[j].Age })
	fmt.Println(ps)
}
`,
		"[a b c]\n[9 5 6 7 8 4]\ntrue\n[{B 25} {D 25} {A 30} {C 30}]\n",
	);
});

test("Slice ties on large random input follow Go's pdqsort", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"sort"
)

type P struct {
	N int
	K int
}

func main() {
	for _, n := range []int{2000, 20000} {
		xs := make([]P, n)
		s := 7
		for i := range xs {
			s = (s*48271 + 12345) % 2147483647
			xs[i] = P{i, s % 50}
		}
		sort.Slice(xs, func(i, j int) bool { return xs[i].K < xs[j].K })
		h := 0
		for _, x := range xs {
			h = (h*31 + x.N) % 1000003
		}
		fmt.Println(n, h, xs[:4])
	}
}
`,
		"2000 875289 [{433 0} {688 0} {666 0} {122 0}]\n20000 55619 [{5651 0} {6816 0} {10767 0} {3195 0}]\n",
	);
});
