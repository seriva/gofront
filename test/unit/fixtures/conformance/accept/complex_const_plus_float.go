package main

import "fmt"

func main() {
	var f float64 = 1
	fmt.Println(f + (1 + 0i))
	var g float32 = 0.5
	const c = 2 + 0i
	fmt.Println(g * c)
}

// Output:
// 2
// 1
