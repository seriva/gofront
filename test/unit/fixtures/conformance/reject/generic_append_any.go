package main

func A1[T any](v T) {
	_ = append(v, 1) // ERROR "invalid append: argument must be a slice; have v (variable of type T constrained by any)"
}

func A2[T ~[]int | ~map[int]int](v T) {
	_ = append(v, 1) // ERROR "invalid append: argument must be a slice; have v (variable of type T constrained by ~[]int | ~map[int]int)"
}

func C1[T any](v T) {
	copy(v, v) // ERROR "invalid copy: argument must be a slice; have v (variable of type T constrained by any)"
}

func C2[T any](v T) {
	copy([]int{}, v) // ERROR "invalid copy: argument must be a slice; have v (variable of type T constrained by any)"
}

func main() {
	A1([]int{})
	C1([]int{})
}

func A3[T ~[]int | ~[]string](v T) {
	_ = append(v) // ERROR "invalid append: mismatched slice element types int and string in v (variable of type T constrained by ~[]int | ~[]string)"
}

func C3[T ~[]int | ~[]string](v T) {
	copy(v, v) // ERROR "invalid copy: mismatched slice element types int and string in v (variable of type T constrained by ~[]int | ~[]string)"
}
