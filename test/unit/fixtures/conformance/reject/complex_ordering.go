package main

func main() {
	c := 1i
	_ = c < 2i // ERROR "invalid operation: c < 2i (operator < not defined on complex128)"
}
