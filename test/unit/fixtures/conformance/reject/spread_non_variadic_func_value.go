package main

func f(xs []int) {}

func main() {
	g := func(xs []int) {}
	g([]int{1}...)       // ERROR "cannot use ... in call to non-variadic g"
	defer f([]int{1}...) // ERROR "cannot use ... in call to non-variadic f"
}
