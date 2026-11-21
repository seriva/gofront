package main

func f(a int, xs ...int) {}

func g(xs ...int) {}

func main() {
	f(1, 2, []int{1}...) // ERROR "too many arguments in call to f"
	g(1, []int{2}...)    // ERROR "too many arguments in call to g"
	f([]int{1}...)       // ERROR "not enough arguments in call to f"
}
