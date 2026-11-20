package main

func C1[T any](v T) {
	clear(v) // ERROR "invalid argument: cannot clear v (variable of type T constrained by any): argument must be (or constrained by) map or slice"
}

func C2[T ~[]int | ~string](v T) {
	clear(v) // ERROR "cannot clear v (variable of type T constrained by ~[]int | ~string)"
}

func main() {
	C1([]int{1})
}
