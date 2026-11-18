// compile-only
package main

func F[T any](v T) {
	{
		var T int
		T = 2
		_ = &T
	}
}

func main() {
	ArrayBuffer := 1
	ArrayBuffer = 2
	_ = &ArrayBuffer
	F[int](1)
}
