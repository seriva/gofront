package main

func main() {
	_ = map[int]int(1) // ERROR "cannot convert 1 (untyped int constant) to type map[int]int"
}
