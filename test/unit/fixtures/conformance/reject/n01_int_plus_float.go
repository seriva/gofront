package main

func main() {
	a := 1
	f := 2.5
	_ = a + f // ERROR "mismatched types int and float64"
}
