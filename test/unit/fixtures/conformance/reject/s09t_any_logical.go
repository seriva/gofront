package main

func main() {
	var v any = true
	_ = v && true // ERROR "operator && not defined on v (variable of type any)"
}
