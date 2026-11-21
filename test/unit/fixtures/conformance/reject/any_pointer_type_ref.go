package main

func main() {
	p := (*any)(nil)
	_ = *p + 1 // ERROR "*p + 1 (mismatched types any and untyped int)"
}
