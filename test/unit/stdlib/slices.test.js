// GoFront test suite — slices (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import { assertFourWay, section, test } from "../helpers.js";

section("slices (Go-source)");

test("nil, empty and named slices keep their type", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"slices"
)

type IDs []int

func (x IDs) Sum() int {
	t := 0
	for _, v := range x {
		t += v
	}
	return t
}

func main() {
	var nilS []int
	fmt.Println(slices.Contains(nilS, 1), slices.Index(nilS, 1), slices.Clone(nilS) == nil, slices.Equal(nilS, []int{}))
	fmt.Println(slices.Compact(nilS) == nil, slices.Delete(nilS, 0, 0) == nil, slices.Insert(nilS, 0) == nil)
	ids := IDs{1, 2, 3}
	a := slices.Insert(ids, 1, 9, 8)
	fmt.Printf("%T %v %d\\n", a, a, a.Sum())
	b := slices.Delete(slices.Clone(a), 1, 3)
	fmt.Printf("%T %v %d\\n", b, b, b.Sum())
	c := slices.Compact(IDs{1, 1, 2, 2, 2, 3, 1})
	fmt.Printf("%T %v\\n", c, c)
	g := slices.Grow(ids, 10)
	fmt.Printf("%T %v %v\\n", g, len(g), cap(g) >= 13)
	fmt.Printf("%T %v\\n", slices.Clip(ids), slices.Clip(ids))
	fmt.Printf("%T %v\\n", slices.Concat(ids, IDs{4}), slices.Concat(ids, IDs{4}))
	fmt.Printf("%T %v\\n", slices.Repeat(ids, 2), slices.Repeat(ids, 2))
	fmt.Println(slices.Concat[[]int]() == nil, len(slices.Repeat([]int{1}, 0)))
}
`,
		"false -1 true true\ntrue true true\nmain.IDs [1 9 8 2 3] 23\nmain.IDs [1 2 3] 6\nmain.IDs [1 2 3 1]\nmain.IDs 3 true\nmain.IDs [1 2 3]\nmain.IDs [1 2 3 4]\nmain.IDs [1 2 3 1 2 3]\ntrue 0\n",
	);
});

test("Insert Delete Replace Compact Concat Clip Grow", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"slices"
	"strings"
)

func main() {
	fmt.Println(slices.Insert([]int{1, 2, 5}, 2, 3, 4), slices.Insert([]int{1}, 1, 2), slices.Insert([]int{1, 2}, 0))
	fmt.Println(slices.Delete([]int{1, 2, 3, 4, 5, 6}, 1, 4), slices.Delete([]string{"a", "b"}, 0, 2), slices.DeleteFunc([]int{1, 2, 3, 4}, func(x int) bool { return x%2 == 0 }))
	fmt.Println(slices.Replace([]int{1, 2, 3, 4, 5}, 1, 3, 7, 8, 9), slices.Replace([]int{1, 2, 3, 4, 5}, 1, 4, 7), slices.Replace([]int{1, 2}, 1, 1, 5))
	fmt.Println(slices.Compact([]int{1, 1, 2, 3, 3}), slices.CompactFunc([]string{"a", "A", "b"}, strings.EqualFold))
	fmt.Println(slices.Concat([]int{1}, nil, []int{2, 3}), slices.Clip([]int{1, 2}), slices.Repeat([]int{1, 2}, 3))
	s := make([]int, 3, 10)
	g := slices.Grow(s, 5)
	fmt.Println(len(g), cap(g) >= 8, len(slices.Clip(g)) == cap(slices.Clip(g)))
	t := []int{1, 2, 3, 4, 5, 6}
	d := slices.Delete(t, 1, 3)
	fmt.Println(d, t)
	type P struct{ X, Y int }
	ps := []P{{1, 2}, {3, 4}}
	ps = slices.Insert(ps, 0, P{9, 9})
	ps = slices.Replace(ps, 1, 2, P{7, 7}, P{8, 8})
	fmt.Println(ps)
}
`,
		"[1 2 3 4 5] [1 2] [1 2]\n[1 5 6] [] [1 3]\n[1 7 8 9 4 5] [1 7 5] [1 5 2]\n[1 2 3] [a b]\n[1 2 3] [1 2] [1 2 1 2 1 2]\n3 true true\n[1 4 5 6] [1 4 5 6 0 0]\n[{9 9} {7 7} {8 8} {3 4}]\n",
	);
});

test("Insert and Replace with an argument that aliases the slice", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"slices"
)

func main() {
	s := []int{1, 2, 3, 4, 5, 6}
	fmt.Println(slices.Insert(s[:3], 1, s[4:]...), s)
	u := make([]int, 6, 20)
	copy(u, []int{1, 2, 3, 4, 5, 6})
	fmt.Println(slices.Insert(u, 2, u[3:5]...), u[:8])
	w := make([]int, 6, 20)
	copy(w, []int{1, 2, 3, 4, 5, 6})
	fmt.Println(slices.Replace(w, 1, 2, w[3:6]...), w[:8])
	x := []int{1, 2, 3, 4, 5, 6}
	fmt.Println(slices.Replace(x, 0, 2, x[2:]...), x)
}
`,
		"[1 5 6 2 3] [1 5 6 2 3 6]\n[1 2 4 5 3 4 5 6] [1 2 4 5 3 4 5 6]\n[1 4 5 6 3 4 5 6] [1 4 5 6 3 4 5 6]\n[3 4 5 6 3 4 5 6] [1 2 3 4 5 6]\n",
	);
});

test("Equal Compare Index Contains with structs, arrays and floats", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"math"
	"slices"
	"strings"
)

type P struct {
	N string
	A int
}

func main() {
	fmt.Println(slices.Equal([]P{{"a", 1}}, []P{{"a", 1}}), slices.Index([]P{{"a", 1}, {"b", 2}}, P{"b", 2}), slices.Contains([][2]int{{1, 2}}, [2]int{1, 2}))
	fmt.Println(slices.Equal([]float64{math.NaN()}, []float64{math.NaN()}), slices.Contains([]float64{math.NaN()}, math.NaN()), slices.Index([]float64{1, 2}, 2))
	fmt.Println(slices.Compare([]int{1, 2}, []int{1, 3}), slices.Compare([]int{1, 2}, []int{1, 2, 0}), slices.Compare([]int{1, 2}, []int{1, 2}), slices.Compare([]float64{math.NaN()}, []float64{1}), slices.Compare([]float64{math.NaN()}, []float64{math.NaN()}))
	fmt.Println(slices.EqualFunc([]int{1}, []string{"1"}, func(i int, s string) bool { return fmt.Sprint(i) == s }), slices.CompareFunc([]string{"a"}, []string{"B"}, func(a, b string) int { return strings.Compare(strings.ToLower(a), strings.ToLower(b)) }))
	fmt.Println(slices.IndexFunc([]int{1, 2, 3}, func(x int) bool { return x > 1 }), slices.ContainsFunc([]int{1}, func(x int) bool { return x > 1 }))
	fmt.Println(slices.Equal([]string{"a", "b"}, []string{"a", "b"}), slices.Index([]string{"a", "b"}, "b"), slices.Contains([]bool{true}, false), slices.Index([]uint8{1, 2, 3}, 3), slices.Contains([]int64{1 << 40}, 1<<40))
}
`,
		"true 1 true\nfalse false 1\n-1 -1 0 -1 0\ntrue -1\n1 false\ntrue 1 false 2 true\n",
	);
});

test("Min Max and their Func forms", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"math"
	"slices"
)

type P struct {
	N string
	A int
}

func main() {
	fmt.Println(slices.Min([]int{3, 1, 2}), slices.Max([]int{3, 1, 2}), slices.Min([]string{"b", "a"}), slices.Max([]string{"b", "a"}))
	fmt.Println(slices.Max([]float64{1, math.NaN(), 3}), slices.Min([]float64{1, math.NaN(), 3}), slices.Min([]float64{0, math.Copysign(0, -1)}), slices.Max([]float64{math.Copysign(0, -1), 0}))
	byA := func(x, y P) int { return x.A - y.A }
	fmt.Println(slices.MinFunc([]P{{"a", 3}, {"b", 1}, {"c", 1}}, byA), slices.MaxFunc([]P{{"a", 3}, {"b", 1}, {"c", 3}}, byA))
	fmt.Println(slices.Min([]uint32{0x80000000, 1}), slices.Max([]uint32{0x80000000, 1}), slices.Max([]uint64{1 << 63, 1}))
	for _, f := range []func(){
		func() { slices.Min([]int{}) },
		func() { slices.Max([]float64(nil)) },
		func() { slices.MinFunc([]P{}, byA) },
		func() { slices.MaxFunc([]P(nil), byA) },
	} {
		func() {
			defer func() { fmt.Println(recover()) }()
			f()
		}()
	}
}
`,
		"1 3 a b\nNaN NaN -0 0\n{b 1} {a 3}\n1 2147483648 9223372036854775808\nslices.Min: empty list\nslices.Max: empty list\nslices.MinFunc: empty list\nslices.MaxFunc: empty list\n",
	);
});

test("Sort orders NaN first and -0 with 0", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"math"
	"slices"
)

func main() {
	f := []float64{3, math.NaN(), 1, math.Inf(-1), 2, math.Copysign(0, -1), 0}
	slices.Sort(f)
	fmt.Println(f, slices.IsSorted(f))
	g := []float64{math.NaN(), 2, math.NaN(), 1}
	slices.Sort(g)
	fmt.Println(g)
	i, ok := slices.BinarySearch(g, 2)
	fmt.Println(i, ok)
	j, ok2 := slices.BinarySearch(g, math.NaN())
	fmt.Println(j, ok2)
	u := []uint32{0x80000000, 1, 0xffffffff}
	slices.Sort(u)
	fmt.Println(u, slices.IsSorted(u))
	s := []string{"b", "a", "é", "B"}
	slices.Sort(s)
	fmt.Println(s)
	k := []int{5, -1, 3}
	slices.Sort(k)
	fmt.Println(k)
	var n []int
	slices.Sort(n)
	fmt.Println(n == nil, slices.IsSorted(n))
}
`,
		"[NaN -Inf -0 0 1 2 3] true\n[NaN NaN 1 2]\n3 true\n0 true\n[1 2147483648 4294967295] true\n[B a b é]\n[-1 3 5]\ntrue true\n",
	);
});

test("BinarySearch and BinarySearchFunc", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"slices"
	"strings"
)

type P struct {
	N string
	A int
}

func main() {
	i, ok := slices.BinarySearch([]int{1, 3, 5}, 3)
	j, ok2 := slices.BinarySearch([]int{1, 3, 5}, 4)
	k, ok3 := slices.BinarySearch([]int{}, 4)
	fmt.Println(i, ok, j, ok2, k, ok3)
	m, ok4 := slices.BinarySearchFunc([]P{{"a", 1}, {"b", 2}, {"d", 3}}, "b", func(p P, s string) int { return strings.Compare(p.N, s) })
	n, ok5 := slices.BinarySearchFunc([]P{{"a", 1}, {"b", 2}, {"d", 3}}, "c", func(p P, s string) int { return strings.Compare(p.N, s) })
	fmt.Println(m, ok4, n, ok5)
}
`,
		"1 true 2 false 0 false\n1 true 2 false\n",
	);
});

test("SortFunc ties follow Go's pdqsort", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"slices"
)

type P struct {
	N int
	K int
}

func main() {
	for _, n := range []int{5, 13, 40, 1000} {
		xs := make([]P, n)
		for i := range xs {
			xs[i] = P{i, (i * 7) % 3}
		}
		slices.SortFunc(xs, func(a, b P) int { return a.K - b.K })
		h := 0
		for _, x := range xs {
			h = (h*31 + x.N) % 1000003
		}
		fmt.Println(n, xs[:min(n, 8)], h)
	}
	ys := make([]int, 40)
	for i := range ys {
		ys[i] = i
	}
	slices.SortFunc(ys, func(a, b int) int { return a%3 - b%3 })
	fmt.Println(ys)
}
`,
		"5 [{0 0} {3 0} {1 1} {4 1} {2 2}] 90460\n13 [{6 0} {3 0} {0 0} {9 0} {12 0} {1 1} {4 1} {7 1}] 895110\n40 [{15 0} {39 0} {36 0} {3 0} {33 0} {30 0} {6 0} {27 0}] 554792\n1000 [{336 0} {999 0} {996 0} {3 0} {993 0} {990 0} {6 0} {987 0}] 420388\n[15 39 36 3 33 30 6 27 24 9 0 21 12 18 10 4 16 1 13 19 37 34 22 31 28 25 7 14 8 29 5 23 32 26 11 35 2 20 38 17]\n",
	);
});

test("SortStableFunc keeps equal elements in order", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"slices"
)

type P struct {
	N int
	K int
}

func main() {
	for _, n := range []int{5, 13, 40, 1000} {
		xs := make([]P, n)
		for i := range xs {
			xs[i] = P{i, (i * 7) % 3}
		}
		slices.SortStableFunc(xs, func(a, b P) int { return a.K - b.K })
		ok := true
		for i := 1; i < n; i++ {
			if xs[i-1].K > xs[i].K || (xs[i-1].K == xs[i].K && xs[i-1].N > xs[i].N) {
				ok = false
			}
		}
		fmt.Println(n, ok, xs[:min(n, 6)])
	}
}
`,
		"5 true [{0 0} {3 0} {1 1} {4 1} {2 2}]\n13 true [{0 0} {3 0} {6 0} {9 0} {12 0} {1 1}]\n40 true [{0 0} {3 0} {6 0} {9 0} {12 0} {15 0}]\n1000 true [{0 0} {3 0} {6 0} {9 0} {12 0} {15 0}]\n",
	);
});

test("large sorts and SortedFunc", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"slices"
)

func main() {
	n := 20000
	xs := make([]int, n)
	s := 1
	for i := range xs {
		s = (s*48271 + 12345) % 2147483647
		xs[i] = s % 1000
	}
	ys := slices.Clone(xs)
	slices.Sort(xs)
	slices.SortFunc(ys, func(a, b int) int { return b - a })
	fmt.Println(slices.IsSorted(xs), xs[0], xs[n-1], ys[0], ys[n-1], slices.IsSortedFunc(ys, func(a, b int) int { return b - a }))
	asc := make([]int, n)
	for i := range asc {
		asc[i] = i
	}
	desc := slices.Clone(asc)
	slices.Reverse(desc)
	slices.Sort(desc)
	same := make([]int, n)
	slices.Sort(same)
	fmt.Println(slices.Equal(asc, desc), same[n-1])
}
`,
		"true 0 999 999 0 true\ntrue 0\n",
	);
});

test("Reverse on nil, empty and shared slices", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"slices"
)

func main() {
	var n []int
	slices.Reverse(n)
	fmt.Println(n == nil)
	r := []int{1, 2, 3, 4, 5}
	slices.Reverse(r[1:4])
	fmt.Println(r)
	b := []byte("hello")
	slices.Reverse(b)
	fmt.Println(string(b))
	f := []float32{1.5, 2.5}
	slices.Reverse(f)
	fmt.Println(f, slices.Index(f, 1.5))
	d := slices.Delete(r[1:], 0, 1)
	fmt.Println(d, r)
	c := slices.Clone(r[1:3])
	c[0] = 100
	fmt.Println(c, r)
}
`,
		"true\n[1 4 3 2 5]\nolleh\n[2.5 1.5] 1\n[3 2 5] [1 3 2 5 0]\n[100 2] [1 3 2 5 0]\n",
	);
});

test("iterator members", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"maps"
	"slices"
)

func main() {
	for i, v := range slices.All([]string{"x", "y"}) {
		fmt.Print(i, v, " ")
	}
	for i, v := range slices.Backward([]string{"x", "y"}) {
		fmt.Print(i, v, " ")
	}
	for c := range slices.Chunk([]int{1, 2, 3, 4, 5}, 2) {
		fmt.Print(c, len(c), cap(c), " ")
	}
	fmt.Println()
	fmt.Println(slices.Collect(slices.Values([]int{1, 2})), slices.Sorted(slices.Values([]int{3, 1, 2})))
	fmt.Println(slices.AppendSeq([]int{0}, slices.Values([]int{1, 2})), slices.SortedFunc(slices.Values([]int{3, 1, 2}), func(a, b int) int { return b - a }))
	m := map[string]int{"b": 2, "a": 1, "c": 3}
	fmt.Println(slices.Sorted(maps.Keys(m)), slices.Sorted(maps.Values(m)))
}
`,
		"0x 1y 1y 0x [1 2] 2 2 [3 4] 2 2 [5] 1 1 \n[1 2] [1 2 3]\n[0 1 2] [3 2 1]\n[a b c] [1 2 3]\n",
	);
});

test("out of range arguments panic", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"slices"
)

func try(name string, f func()) {
	defer func() { fmt.Println(name, recover() != nil) }()
	f()
}

func main() {
	try("insert", func() { slices.Insert([]int{1, 2}, 5, 99) })
	try("delete", func() { slices.Delete([]int{1, 2}, 1, 5) })
	try("delete-order", func() { slices.Delete([]int{1, 2, 3}, 2, 1) })
	try("replace", func() { slices.Replace([]int{1, 2}, 3, 4) })
	try("grow", func() { slices.Grow([]int{1}, -1) })
	try("repeat", func() { slices.Repeat([]int{1}, -1) })
	try("chunk", func() { slices.Chunk([]int{1}, 0) })
	try("ok", func() { slices.Insert([]int{1, 2}, 2, 99) })
}
`,
		"insert true\ndelete true\ndelete-order true\nreplace true\ngrow true\nrepeat true\nchunk true\nok false\n",
	);
});

test("ties on large random input follow Go's pdqsort", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"slices"
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
		slices.SortFunc(xs, func(a, b P) int { return a.K - b.K })
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
