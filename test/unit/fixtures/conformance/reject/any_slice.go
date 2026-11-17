package main

func main() {
	var v any = []int{1}
	_ = v[:1] // ERROR "cannot slice v (variable of type any)"
}
