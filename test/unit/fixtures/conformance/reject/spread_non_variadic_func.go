package main

func f(xs []int) {}

func gen[E any](xs []E) {}

func main() {
	f([]int{1}...)   // ERROR "cannot use ... in call to non-variadic f"
	gen([]int{1}...) // ERROR "cannot use ... in call to non-variadic gen"
}
