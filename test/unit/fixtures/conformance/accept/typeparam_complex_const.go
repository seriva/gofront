package main

import "fmt"

func f[T ~int | ~float64]() T { var t T = 1 + 0i; return t }

func g[T ~int | ~float64](a T) T { return a + (2 + 0i) }

func main() {
	fmt.Println(f[int](), f[float64](), g(3), g(1.5))
}

// Output:
// 1 1 5 3.5
