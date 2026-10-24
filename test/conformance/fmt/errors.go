package main

import "fmt"

func main() {
	// Missing arguments
	fmt.Println(fmt.Sprintf("%d %s", 1))
	fmt.Println(fmt.Sprintf("%d"))

	// Extra arguments
	fmt.Println(fmt.Sprintf("%d", 1, "a", 2.5))

	// Explicit argument index out of range
	fmt.Println(fmt.Sprintf("%[3]d", 1))
	fmt.Println(fmt.Sprintf("%[0]d", 1))

	// Incomplete format
	fmt.Println(fmt.Sprintf("%"))

	// Unknown verb
	fmt.Println(fmt.Sprintf("%z", 3))
	fmt.Println(fmt.Sprintf("%Y", "str"))
}
