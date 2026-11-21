package main

func main() {
	var v any
	var n int
	_ = v << 1 // ERROR "shifted operand v ("
	_ = n << v // ERROR "shift count v ("
	_ = v + "a" // ERROR "v + \"a\" (mismatched types any and string)"
}
