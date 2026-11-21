package main

func E1[M ~map[string]int | ~map[int]int](m M) {
	delete(m, 1) // ERROR "invalid argument: maps of m (variable of type M constrained by ~map[string]int | ~map[int]int) must have identical key types"
}

func E2[M ~map[string]int](m M) {
	delete(m, 1) // ERROR "cannot use 1 (untyped int constant) as string value in"
}

func main() {}
