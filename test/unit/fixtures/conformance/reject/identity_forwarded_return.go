package main

type A struct{ X int }

func pair() (A, int) { return A{7}, 9 }

func wrap() (struct{ X int }, int) {
	return pair() // ERROR "Cannot assign A to struct{X int} here"
}

func main() { wrap() }
