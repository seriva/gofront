package main

import (
	"cmp"
	"errors"
	"fmt"
)

type Q struct {
	A int
	B string
}

func c[C comparable](x C) bool { return x == x }

func h[T comparable](x T) bool { return c(x) }

func o[T cmp.Ordered](x T) bool { return c(x) }

func main() {
	var e error = errors.New("x")
	p := 1
	var a any = 1
	fmt.Println(c(e), c(Q{1, "a"}), c(&p), c([2]int{1, 2}), c(a))
	fmt.Println(h(1), o("s"), c[float64](2))
}

// Output:
// true true true true true
// true true true
