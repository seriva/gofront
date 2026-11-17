package main

func main() {
	var v any = 2
	_ = *v // ERROR "cannot indirect v (variable of type any)"
}
