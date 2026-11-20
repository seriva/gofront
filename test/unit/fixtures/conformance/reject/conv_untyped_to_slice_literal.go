package main

func main() {
	_ = []int(1) // ERROR "cannot convert 1 (untyped int constant) to type []int"
}
