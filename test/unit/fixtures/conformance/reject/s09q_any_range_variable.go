package main

func main() {
	var v any = []int{1}
	for i, x := range v { // ERROR "cannot range over v (variable of type any)"
		_, _ = i, x
	}
}
