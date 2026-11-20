package main

func f(xs ...int) {}

func main() {
	var v any = []int{1}
	f(v...) // ERROR "cannot use v (variable of type any) as []int value"
}
