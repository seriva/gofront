package main

func main() {
	b := true
	_ = b && 1    // ERROR "mismatched types bool and untyped int"
	_ = 1 && true // ERROR "mismatched types untyped int and untyped bool"
}
