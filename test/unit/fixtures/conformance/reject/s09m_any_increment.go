package main

func main() {
	var v any = 2
	v++ // ERROR "operator ++ not defined on v (variable of type any)"
}
