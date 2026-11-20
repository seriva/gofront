package main

func main() {
	var f float32 = 1
	_ = f == 1e40 // ERROR "1e40 (untyped float constant 1e+40) overflows float32"
}
