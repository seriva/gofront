package main

func F[T ~int | ~float64](s uint) T {
	var x T = 1 << s // ERROR "shifted operand 1 (type T constrained by ~int | ~float64) must be integer"
	return x
}

func main() {}
