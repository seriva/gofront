package main

func main() {
	x := 1
	_ = x || x // ERROR "operator || not defined on x (variable of type int)"
}
