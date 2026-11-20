package main

func main() {
	s := uint(1)
	_ = complex128(1 << s) // ERROR "shifted operand 1 (type complex128) must be integer"
}
