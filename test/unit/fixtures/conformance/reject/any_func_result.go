package main

func get() any { return 2 }

func main() {
	_ = get() * 2 // ERROR "mismatched types any and untyped int"
}
