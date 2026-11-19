package main

import "fmt"

type Base struct{ S []int }

type Outer struct{ *Base }

func c[C comparable](x C) bool { return x == x }

func main() {
	fmt.Println(c(Outer{}))
}

// Output:
// true
