package main

import "fmt"

func main() {
	var v any = true
	switch {
	case v:
		fmt.Println("hit")
	}
}

// Output:
// hit
