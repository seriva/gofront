package main

func main() {
	n := 1
	_ = n == "a" // ERROR "mismatched types int and untyped string"
}
