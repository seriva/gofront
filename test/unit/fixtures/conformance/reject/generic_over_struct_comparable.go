package main

type S[T any] struct{ X []T }
type W[T any] S[T]

type Cmp interface{ comparable }

func cmp[C Cmp](c C) {}

func main() {
	cmp(W[int]{}) // ERROR "does not satisfy"
}
