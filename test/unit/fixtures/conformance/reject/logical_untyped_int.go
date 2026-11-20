package main

func main() {
	_ = 1 && 2 // ERROR "operator && not defined on 1 (untyped int constant)"
}
