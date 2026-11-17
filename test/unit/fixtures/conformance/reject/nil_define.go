package main

func main() {
	x := nil // ERROR "use of untyped nil in assignment"
	_ = x
}
