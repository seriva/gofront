package main

type P struct{ S []int }

type Q struct{ Inner [2]P }

func c[C comparable](x C) {}

func main() {
	c(P{})  // ERROR "P does not satisfy comparable"
	c(Q{})  // ERROR "Q does not satisfy comparable"
	c[[]int](nil) // ERROR "[]int does not satisfy comparable"
}
