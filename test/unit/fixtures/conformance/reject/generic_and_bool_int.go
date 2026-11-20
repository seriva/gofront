package main

func F[T ~bool](a T, b int) T {
	return a && b // ERROR "invalid operation: a && b (mismatched types T and int)"
}

func G[T ~bool](a T, b int) bool {
	return a == b // ERROR "invalid operation: a == b (mismatched types T and int)"
}

func H[T ~bool](a T, b bool) T {
	return b || a // ERROR "invalid operation: b || a (mismatched types bool and T)"
}

func main() {}
