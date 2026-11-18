package main

import (
	"cmp"
	"fmt"
)

func Mod[T ~int | ~int64](a, b T) T { return a % b }

func Add[T ~int | ~string](a, b T) T { return a + b }

func Less[T cmp.Ordered](a, b T) bool { return a < b }

func Same[T comparable](a, b T) bool { return a == b }

func Shl[T ~int | ~uint8](a T) T { return a << 1 }

func Inc[T ~int | ~float64](a T) T {
	a++
	a += 2
	return a
}

func main() {
	fmt.Println(Mod(7, 4), Add("a", "b"), Less(1, 2), Same("x", "x"), Shl(3), Inc(1.5))
}

// Output:
// 3 ab true true 6 4.5
