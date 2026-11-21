package main

func main() {
	var f float64 = 2i // ERROR "cannot use 2i (untyped complex constant (0 + 2i)) as float64 value in variable declaration (overflows)"
	_ = f
}
