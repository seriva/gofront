package main

import (
	"cmp"
	"fmt"
	"slices"
)

func Id[T any](x T) T { return x }

func Map[T, U any](xs []T, f func(T) U) []U {
	out := make([]U, 0, len(xs))
	for _, x := range xs {
		out = append(out, f(x))
	}
	return out
}

func double(x int) int { return x * 2 }

func main() {
	f := Id[int]
	g := Id[string]
	fmt.Println(f(1), g("a"), Id(3), Id("b"))
	xs := []int{3, 1, 2}
	slices.SortFunc(xs, cmp.Compare[int])
	slices.Reverse(xs)
	fmt.Println(xs, Map(xs, double), Map[int, string](xs, func(i int) string { return fmt.Sprint(i) }))
	defer Id(1)
}

// Output:
// 1 a 3 b
// [3 2 1] [6 4 2] [3 2 1]
