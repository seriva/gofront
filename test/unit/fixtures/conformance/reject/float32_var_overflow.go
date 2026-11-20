package main

func main() {
	var f float32 = 1e40 // ERROR "cannot use 1e40 (untyped float constant 1e+40) as float32 value in variable declaration (overflows)"
	_ = f
}
