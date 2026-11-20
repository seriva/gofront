package main

import "fmt"

func main() {
	const c = 1 + 0i
	var n int = 1
	fmt.Println(n == c)
}

// Output:
// true
