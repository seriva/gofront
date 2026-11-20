package main

func F[T ~int](a T) T {
	return a + 1.5 // ERROR "cannot convert 1.5 (untyped float constant) to type T"
}

func G[T ~int | ~float64](a T) T {
	return 1.5 * a // ERROR "cannot convert 1.5 (untyped float constant) to type T"
}

func H[T ~int](a T) bool {
	return a < 1.5 // ERROR "cannot convert 1.5 (untyped float constant) to type T"
}

const half = 0.5

func I[T ~int](a T) T {
	return a - half // ERROR "cannot convert half (untyped float constant 0.5) to type T"
}

func main() {}
