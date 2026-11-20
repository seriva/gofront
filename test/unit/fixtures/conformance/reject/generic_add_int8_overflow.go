package main

func F[T ~int8](a T) T {
	return a + 200 // ERROR "cannot convert 200 (untyped int constant) to type T"
}

func G[T ~int8 | ~int](a T) bool {
	return a == 128 // ERROR "cannot convert 128 (untyped int constant) to type T"
}

func H[T ~uint | ~int](a T) T {
	return a - -1 // ERROR "cannot convert -1 (untyped int constant) to type T"
}

func main() {}
