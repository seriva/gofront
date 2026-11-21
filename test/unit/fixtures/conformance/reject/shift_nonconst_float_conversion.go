package main

func main() {
	s := uint(1)
	_ = float64(1 << s) // ERROR "shifted operand 1 (type float64) must be integer"
}
