package main

func F[M ~map[K]V, K comparable, V any](m M) {}

func main() {
	F[int, int, int](1) // ERROR "int does not satisfy ~map[int]int"
}
