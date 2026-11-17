package main

var g = nil // ERROR "use of untyped nil in variable declaration"

func main() {
	var x = nil // ERROR "use of untyped nil in variable declaration"
	_ = x
}
