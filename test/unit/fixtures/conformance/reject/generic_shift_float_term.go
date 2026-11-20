package main

func A[T ~int | ~float64](a T) T {
	return a << 1 // ERROR "shifted operand a"
}

func main() {}
