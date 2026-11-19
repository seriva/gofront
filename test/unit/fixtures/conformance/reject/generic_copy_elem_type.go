package main

func P1[D ~[]int, S ~[]string](d D, s S) int {
	return copy(d, s) // ERROR "invalid copy: arguments d (variable of type D constrained by ~[]int) and s (variable of type S constrained by ~[]string) have different element types int and string"
}

func P2[D ~[]byte](d D, s []int) int {
	return copy(d, s) // ERROR "and s (variable of type []int) have different element types"
}

func P3[D ~[]int](d D, s []string) int {
	return copy(d, s) // ERROR "invalid copy: arguments d (variable of type D constrained by ~[]int) and s (variable of type []string) have different element types int and string"
}

func P4[D ~[]byte, S ~string | ~[]int](d D, s S) int {
	return copy(d, s) // ERROR "invalid copy: argument must be a slice; have s (variable of type S constrained by ~string | ~[]int)"
}

func main() {}
