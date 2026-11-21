package main

func main() {
	var v any = 2
	_ = v * 2 // ERROR "v * 2 (mismatched types any and untyped int)"
}
