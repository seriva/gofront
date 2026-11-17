package main

func main() {
	var v any = 2
	for range v { // ERROR "cannot range over v (variable of type any)"
	}
}
