package main

func F[T ~bool | ~int](a T) T {
	return !a // ERROR "invalid operation: operator ! not defined on a (variable of type T constrained by ~bool | ~int)"
}

func G[T any](a T) T {
	return !a // ERROR "invalid operation: operator ! not defined on a (variable of type T constrained by any)"
}

func main() {}
