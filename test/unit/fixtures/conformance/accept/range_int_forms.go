package main

import "fmt"

func count[T ~int](x T) int {
	c := 0
	for i := range x {
		c += int(i)
	}
	return c
}

func main() {
	for i := range 3 {
		fmt.Print(i)
	}
	n := 3
	for i := range n {
		fmt.Print(i)
	}
	const m = 3
	for i := range m {
		fmt.Print(i)
	}
	for i := range 'a' {
		_ = i
	}
	fmt.Print(count(3))
	fmt.Println()
}

// Output:
// 0120120123
