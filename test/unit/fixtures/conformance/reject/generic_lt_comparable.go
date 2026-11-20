package main

func A[T comparable](a, b T) bool {
	return a < b // ERROR "type parameter T cannot use operator <"
}

func main() {}
