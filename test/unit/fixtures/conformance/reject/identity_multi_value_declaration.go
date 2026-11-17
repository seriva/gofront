package main

type A struct{ X int }

func pair() (A, A) { return A{3}, A{4} }

func main() {
	var a, b struct{ X int } = pair() // ERROR "Cannot assign A to struct{...} here"
	_, _ = a, b
}
