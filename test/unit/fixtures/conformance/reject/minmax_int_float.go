package main

func main() {
	var a int
	var b float64
	_ = max(a, b) // ERROR "mismatched types int (previous argument) and float64 (type of b)"
}
