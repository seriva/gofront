package main

func main() {
	_ = float32(1e40) // ERROR "cannot convert 1e40 (untyped float constant 1e+40) to type float32"
}
