package main

import "fmt"

func main() {
	var v any = 2
	fmt.Println(v == 2, v != "x")
	switch v {
	case 1:
		fmt.Println("one")
	case 2:
		fmt.Println("two")
	}
}

// Output:
// true true
// two
