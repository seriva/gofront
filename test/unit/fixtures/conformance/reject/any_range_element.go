package main

func main() {
	xs := []any{1, 2}
	for _, x := range xs {
		_ = x * 2 // ERROR "x * 2 (mismatched types any and untyped int)"
	}
}
