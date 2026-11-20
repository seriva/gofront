package main

func main() {
	s := uint(1)
	var f float64 = 1.5 + (1 << s) // ERROR "shifted operand 1 (type float64) must be integer"
	_ = f
}
