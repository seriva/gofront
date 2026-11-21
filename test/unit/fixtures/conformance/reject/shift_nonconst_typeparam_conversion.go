package main

func F[T ~float64](s uint) T {
	return T(1 << s) // ERROR "shifted operand 1 (type T constrained by ~float64) must be integer"
}

func main() {
	_ = F[float64](1)
}
