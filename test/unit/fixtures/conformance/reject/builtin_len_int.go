package main

func main() {
	_ = len(5) // ERROR "invalid argument: 5 (untyped int constant) for built-in len"
}
