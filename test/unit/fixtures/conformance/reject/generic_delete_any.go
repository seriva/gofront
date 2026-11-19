package main

func D1[T any](v T) {
	delete(v, 1) // ERROR "invalid argument: v (variable of type T constrained by any) is not a map"
}

func D2[T ~map[int]int | ~[]int](v T) {
	delete(v, 1) // ERROR "invalid argument: v (variable of type T constrained by ~map[int]int | ~[]int) is not a map"
}

func main() {
	D1(map[int]int{})
}
