package main

import "fmt"

func F[T interface {
	~int | ~string
	~int
}](a, b T) T {
	return a + b
}

func main() {
	fmt.Println(F(1, 2))
}

// Output:
// 3
