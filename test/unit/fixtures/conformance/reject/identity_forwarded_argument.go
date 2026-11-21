package main

type A struct{ X int }

func pair() (A, int) { return A{7}, 9 }

func show(s struct{ X int }, n int) {}

func main() {
	show(pair()) // ERROR "Cannot assign A to struct{X int} here"
}
