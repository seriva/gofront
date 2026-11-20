package main

func M[T ~int | ~float64](a, b T) T {
	return a % b // ERROR "operator % not defined on a"
}

func main() {
	_ = M(5.5, 2.0)
}
