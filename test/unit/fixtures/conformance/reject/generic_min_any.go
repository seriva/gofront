package main

func M1[T any](a, b T) T {
	return min(a, b) // ERROR "invalid argument: a (variable of type T constrained by any) cannot be ordered"
}

func M2[T any](a, b T) T {
	return max(a, b) // ERROR "invalid argument: a (variable of type T constrained by any) cannot be ordered"
}

func M3[T ~int | ~bool](a, b T) T {
	return max(a, b) // ERROR "invalid argument: a (variable of type T constrained by ~int | ~bool) cannot be ordered"
}

func M4[T ~int | ~complex128](a T) T {
	return min(a, a) // ERROR "cannot be ordered"
}

func main() {
	_ = M1(1, 2)
}
