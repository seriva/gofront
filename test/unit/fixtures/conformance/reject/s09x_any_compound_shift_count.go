package main

func main() {
	var v any = 2
	x := 1
	x <<= v // ERROR "operator << not defined on v (variable of type any)"
}
