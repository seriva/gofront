package main

type I interface{ M() }

func main() {
	var i I
	_ = i == 1 // ERROR "invalid operation: i == 1 (mismatched types I and untyped int)"
}
