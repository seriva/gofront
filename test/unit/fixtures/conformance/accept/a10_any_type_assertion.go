package main

import "fmt"

func main() {
	var v any = "x"
	if s, ok := v.(string); ok {
		fmt.Println(s + "y")
	}
}

// Output:
// xy
