package main

func A[T ~int | ~string](a, b T) T {
	return a - b // ERROR "operator - not defined on a"
}

func main() {}
