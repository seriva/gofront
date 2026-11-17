package main

func main() {
	var v any = 2
	v += 1 // ERROR "operator + not defined on v (variable of type any)"
}
