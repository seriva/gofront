package main

import (
	"cmp"
	"fmt"
)

type Names []string

func Len[T ~[]int | ~string](v T) int { return len(v) }

func LenAll[T ~[]int | ~map[int]int | ~[3]int | ~string](v T) int { return len(v) }

func Cap[T ~[]int | ~[3]int](v T) int { return cap(v) }

func Delete[M ~map[string]int](m M, k string) { delete(m, k) }

func Append[S ~[]E, E any](s S, e E) S { return append(s, e) }

func Copy[S ~[]int](dst, src S) int { return copy(dst, src) }

func Min[T cmp.Ordered](a, b T) T { return min(a, b) }

func Max[T ~int | ~float64 | ~string](a, b T) T { return max(a, b) }

func main() {
	arr := [3]int{1, 2, 3}
	fmt.Println(Len([]int{1, 2}), Len("abc"))
	fmt.Println(LenAll(map[int]int{1: 1}), LenAll(arr), LenAll("ab"))
	fmt.Println(Cap(make([]int, 1, 4)), Cap(arr))
	m := map[string]int{"a": 1, "b": 2}
	Delete(m, "a")
	fmt.Println(len(m))
	fmt.Println(Append(Names{"x"}, "y"))
	dst := make([]int, 2)
	fmt.Println(Copy(dst, []int{7, 8, 9}), dst)
	fmt.Println(Min(3, 2), Min("b", "a"), Max(1.5, 2.5), Max("a", "b"))
}

// Output:
// 2 3
// 1 3 2
// 4 3
// 1
// [x y]
// 2 [7 8]
// 2 a 2.5 b
