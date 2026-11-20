package main

type MS string

func main() {
	var f float64
	_ = string(f) // ERROR "cannot convert f (variable of type float64) to type string"
	_ = MS(f)     // ERROR "cannot convert f (variable of type float64) to type MS"
	_ = string(1.5) // ERROR "cannot convert 1.5 (untyped float constant) to type string"
}
