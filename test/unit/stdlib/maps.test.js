// GoFront test suite — maps (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import { assertFourWay, section, test } from "../helpers.js";

section("maps (Go-source)");

test("maps functions, iterators, named maps and struct keys", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"maps"
	"math"
	"slices"
)

type K struct {
	A string
	B int
}

type L string

func (L) Tag() {}

type M map[string]int

func main() {
	m := map[string]int{"b": 2, "a": 1, "c": 3}
	ks := slices.Sorted(maps.Keys(m))
	vs := slices.Sorted(maps.Values(m))
	fmt.Println(ks, vs)
	c := maps.Clone(m)
	c["d"] = 4
	fmt.Println(len(m), len(c), maps.Equal(m, c))
	var nm map[string]int
	fmt.Println(maps.Clone(nm) == nil)
	maps.Copy(c, map[string]int{"z": 26})
	fmt.Println(len(c))
	maps.DeleteFunc(c, func(k string, v int) bool { return v%2 == 0 })
	fmt.Println(slices.Sorted(maps.Keys(c)))
	fmt.Println(maps.EqualFunc(m, map[string]string{"a": "1", "b": "2", "c": "3"}, func(a int, b string) bool { return fmt.Sprint(a) == b }))
	n := map[float64]int{math.NaN(): 1, 1: 3}
	fmt.Println(slices.Sorted(maps.Keys(n)), len(n))
	sk := slices.Collect(maps.Keys(map[K]int{{"a", 1}: 1}))
	fmt.Println(sk)
	for k := range maps.Keys(map[any]int{L("a"): 1}) {
		_, isL := k.(L)
		_, isS := k.(string)
		fmt.Println(isL, isS, k)
	}
	for k := range maps.Keys(map[any]int{1: 1}) {
		fmt.Printf("%T %v\\n", k, k)
	}
	nn := M{"x": 1}
	cl := maps.Clone(nn)
	fmt.Printf("%T %v\\n", cl, cl)
	dst := map[int]string{}
	maps.Insert(dst, maps.All(map[int]string{1: "a", 2: "b"}))
	fmt.Println(dst)
	col := maps.Collect(maps.All(dst))
	fmt.Println(col, maps.Equal(dst, col))
	cnt := 0
	for range maps.All(map[int]int{1: 1, 2: 2, 3: 3}) {
		cnt++
		break
	}
	fmt.Println(cnt)
}
`,
		`[a b c] [1 2 3]
3 4 false
true
5
[a c]
true
[NaN 1] 2
[{a 1}]
true false a
int 1
main.M map[x:1]
map[1:a 2:b]
map[1:a 2:b] true
1
`,
	);
});
