package main

func main() {
	_ = 1.5 << 1 // ERROR "shifted operand 1.5 (untyped float constant) must be integer"
}
