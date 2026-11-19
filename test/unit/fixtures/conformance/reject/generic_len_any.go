package main

func L1[T any](v T) int {
	return len(v) // ERROR "invalid argument: v (variable of type T constrained by any) for built-in len"
}

func L2[T ~[]int | ~int](v T) int {
	return len(v) // ERROR "invalid argument: v (variable of type T constrained by ~[]int | ~int) for built-in len"
}

func L3[T interface{ M() }](v T) int {
	return len(v) // ERROR "for built-in len"
}

func C1[T any](v T) int {
	return cap(v) // ERROR "invalid argument: v (variable of type T constrained by any) for"
}

func C2[T ~[]int | ~string](v T) int {
	return cap(v) // ERROR "invalid argument: v (variable of type T constrained by ~[]int | ~string) for"
}

func main() {
	_ = L1[int]
	_ = L2[[]int]
	_ = C1[[]int]
}
