package main

func main() {
	_ = struct{ X int }(1) // ERROR "cannot convert 1 (untyped int constant) to type struct"
}
