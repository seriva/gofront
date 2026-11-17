package main

func main() {
	var v any = 1
	_ = min(v, 2) // ERROR "cannot be ordered"
}
