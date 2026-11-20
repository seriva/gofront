package main

func A[T any](a, b T) T {
	return a + b // ERROR "operator + not defined on a"
}

func main() {}
