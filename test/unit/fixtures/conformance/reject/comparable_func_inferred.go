package main

func c[C comparable](x C) {}

func Pair[A any, B comparable](a A, b B) {}

func main() {
	c(func() {})              // ERROR "does not satisfy comparable"
	Pair[int](1, func() {}) // ERROR "does not satisfy comparable"
}
