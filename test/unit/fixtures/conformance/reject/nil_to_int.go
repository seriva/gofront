package main

func main() {
	var i int = nil // ERROR "cannot use nil as int value in variable declaration"
	_ = i
}
