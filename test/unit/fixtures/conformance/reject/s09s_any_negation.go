package main

func main() {
	var v any = true
	_ = !v // ERROR "operator ! not defined on v (variable of type any)"
}
