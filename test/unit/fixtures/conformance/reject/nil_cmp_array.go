package main

func main() {
	var a [2]int
	_ = a == nil // ERROR "mismatched types [2]int and untyped nil"
}
