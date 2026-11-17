package main

import (
	"cmp"
	"fmt"
)

func Id[T any](x T) T { return x }

func apply(f func(int) int) int { return f(1) }

func main() {
	var a any = Id // ERROR "cannot use generic function Id without instantiation"
	_ = a
	fmt.Println(apply(Id)) // ERROR "cannot use generic function Id without instantiation"
	_ = cmp.Compare // ERROR "cannot use generic function cmp.Compare without instantiation"
}
