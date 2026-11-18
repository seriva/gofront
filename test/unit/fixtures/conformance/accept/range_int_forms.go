package main

import "fmt"

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
	fmt.Println()
}

// Output:
// 012012012
