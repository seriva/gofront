package main

func main() {
	var i int = "s" // ERROR "cannot use \"s\" (untyped string constant) as int value in variable declaration"
	_ = i
}
