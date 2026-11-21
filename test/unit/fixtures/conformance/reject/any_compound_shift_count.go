package main

func main() {
	var v any = 2
	x := 1
	x <<= v // ERROR "shift count v (variable of type any) must be integer"
}
