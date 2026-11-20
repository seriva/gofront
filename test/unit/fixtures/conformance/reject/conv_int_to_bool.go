package main

func main() {
	_ = bool(1) // ERROR "cannot convert 1 (untyped int constant) to type bool"
	var i int
	_ = bool(i) // ERROR "cannot convert i (variable of type int) to type bool"
}
