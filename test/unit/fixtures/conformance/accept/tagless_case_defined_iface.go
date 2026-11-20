package main

import "fmt"

type I interface{}

func main() {
	var v I = true
	switch {
	case v:
		fmt.Println("hit")
	}
}

// Output:
// hit
