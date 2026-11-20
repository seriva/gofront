package main

func main() {
	_ = "a" << 1 // ERROR "shifted operand \"a\" (untyped string constant) must be integer"
}
