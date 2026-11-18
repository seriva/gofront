package main

type S[T any] struct{ X T }
type W[T any] S[T]
type B struct{ X int }

type Outer struct {
	W[int]
	B
}

func main() {
	var o Outer
	_ = o.X // ERROR "ambiguous"
}
