package main

func main() {
	m := map[string]any{"a": 2}
	_ = m["a"] * 2 // ERROR "mismatched types any and untyped int"
}
