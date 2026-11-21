package main

func main() {
	var v any = 2
	switch x := v.(type) {
	case string:
		_ = x
	default:
		_ = x + 1 // ERROR "x + 1 (mismatched types any and untyped int)"
	}
}
