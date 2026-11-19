package main

type MyInt int

func F[T ~int](a T, b int) T {
	return a + b // ERROR "invalid operation: a + b (mismatched types T and int)"
}

func G[T ~int](a T, b MyInt) T {
	return b - a // ERROR "invalid operation: b - a (mismatched types MyInt and T)"
}

func H[T ~int, U ~int](a T, b U) T {
	return a * b // ERROR "invalid operation: a * b (mismatched types T and U)"
}

func I[T ~int](a T, b int) bool {
	return a < b // ERROR "invalid operation: a < b (mismatched types T and int)"
}

func J[T ~int](a T, b int) {
	a += b // ERROR "mismatched types T and int"
}

func K[T ~int | ~string](a T) bool {
	return a == 1 // ERROR "invalid operation: a == 1 (mismatched types T and untyped int)"
}

func L[T ~string](a T) T {
	return a + 1 // ERROR "invalid operation: a + 1 (mismatched types T and untyped int)"
}

func M[T ~int | ~float64](a T) T {
	return a + nil // ERROR "invalid operation: a + nil (mismatched types T and untyped nil)"
}

func main() {}
