package main

func main() {
	x := 1
	_ = !x   // ERROR "operator ! not defined on x (variable of type int)"
	_ = !nil // ERROR "operator ! not defined on nil"
}
