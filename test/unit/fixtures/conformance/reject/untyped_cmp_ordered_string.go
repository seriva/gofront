package main

func main() {
	var f float64
	_ = f < "a" // ERROR "mismatched types float64 and untyped string"
}
