package main

func F[T any](v T) {
	T = v // ERROR "cannot assign to T"
	_ = &T // ERROR "cannot take address of T"
}

type G[U any] struct{}

func (g G[U]) M(v U) {
	U = v // ERROR "cannot assign to U"
}

func main() {
	F[int](1)
}
