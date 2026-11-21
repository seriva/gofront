package main

func main() {
	_ = (any)(2) + 1 // ERROR "mismatched types any and untyped int"
}
