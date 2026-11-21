package main

type T struct{}

func (T) m(xs []int) {}

func main() {
	T{}.m([]int{1}...) // ERROR "cannot use ... in call to non-variadic"
}
