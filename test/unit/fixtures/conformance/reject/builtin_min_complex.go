package main

func main() {
	_ = min(1i, 2i) // ERROR "cannot be ordered"
	_ = max(1i, 2i) // ERROR "cannot be ordered"
}
