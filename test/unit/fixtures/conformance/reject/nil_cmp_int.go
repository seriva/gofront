package main

func main() {
	n := 1
	_ = n == nil // ERROR "mismatched types int and untyped nil"
}
