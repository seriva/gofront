package main

func main() {
	var a int
	_ = min(a, 2.5) // ERROR "2.5 (untyped float constant) truncated to int"
}
