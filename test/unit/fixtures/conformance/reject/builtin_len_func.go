package main

func f() {}

func main() {
	_ = len(f) // ERROR "for built-in len"
}
