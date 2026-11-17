package main

import "fmt"

func main() {
	var c complex128 = 2
	switch c {
	case 2:
		fmt.Println("first")
	case 2, 3i:
		fmt.Println("second")
	}
}

// Output:
// first
