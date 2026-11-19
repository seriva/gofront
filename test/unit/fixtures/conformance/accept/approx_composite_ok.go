package main

import "fmt"

type St struct{ A int }

func F[S ~[]E, E any](s S) int { return len(s) }
func G[T ~struct{ A int }](t T) int { return 1 }
func H[T ~int](t T) T { return t }

func main() {
	fmt.Println(F([]int{1, 2}), G(St{1}), H(3))
}

// Output:
// 2 1 3
