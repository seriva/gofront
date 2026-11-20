package main

type S struct {
	_ []int
	_ int
}

func c[C comparable](x C) {}

func main() {
	c(S{}) // ERROR "S does not satisfy comparable"
}
