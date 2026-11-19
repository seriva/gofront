package main

func c[C comparable](x C) {}

func g[T any](x T) {
	c(x) // ERROR "T does not satisfy comparable"
}

func main() {
	g(1)
}
