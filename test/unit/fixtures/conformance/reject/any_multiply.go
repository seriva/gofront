package main

func main() {
	var v any = 2
	_ = v * 2 // ERROR "operator * not defined on v (variable of type any)"
}
