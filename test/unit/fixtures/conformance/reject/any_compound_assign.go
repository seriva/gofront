package main

func main() {
	var v any = 2
	v += 1 // ERROR "v += 1 (mismatched types any and untyped int)"
}
