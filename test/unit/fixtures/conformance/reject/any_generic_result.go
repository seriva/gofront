package main

func first[T any](xs []T) T { return xs[0] }

func main() {
	_ = first([]any{1}) * 2 // ERROR "mismatched types any and untyped int"
}
