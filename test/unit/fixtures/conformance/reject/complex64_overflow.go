package main

func main() {
	var c complex64 = 1e40 // ERROR "cannot use 1e40 (untyped float constant 1e+40) as complex64 value in variable declaration (overflows)"
	_ = c
	var d complex64 = 1e40 + 1i // ERROR "cannot use 1e40 + 1i (untyped complex constant (1e+40 + 1i)) as complex64 value in variable declaration (overflows)"
	_ = d
}
