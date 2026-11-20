package main

func F[T ~complex64](a T) T {
	return a + 1e40 // ERROR "cannot convert 1e40 (untyped float constant 1e+40) to type T"
}

func main() {
	_ = F(complex64(1))
}
