package main

func A[T ~int | ~float64](a, b T) T {
	a %= b // ERROR "operator % not defined on a"
	return a
}

func main() {}
