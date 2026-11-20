package main

type S[T any] struct{ X T }
type W[T any] S[T]

func main() {
	var w W[int]
	_ = w.Missing // ERROR "Missing"
}
