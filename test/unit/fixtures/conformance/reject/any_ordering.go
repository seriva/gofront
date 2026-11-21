package main

func main() {
	var v any = 2
	_ = v < 3 // ERROR "v < 3 (operator < not defined on interface)"
}
