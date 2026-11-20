package main

func main() {
	var f float64 = 1.0
	f <<= 1 // ERROR "shifted operand f (variable of type float64) must be integer"
}
