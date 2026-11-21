package main

func M[T interface{ ~int | ~float64 }](a, b T) T {
	return a % b // ERROR "constrained by interface{~int | ~float64}"
}

func main() {
	_ = M(5.5, 2.0)
}
