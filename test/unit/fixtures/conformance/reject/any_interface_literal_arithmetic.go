package main

func main() {
	var v interface{} = 2
	_ = v * 2 // ERROR "mismatched types interface{} and untyped int"
}
