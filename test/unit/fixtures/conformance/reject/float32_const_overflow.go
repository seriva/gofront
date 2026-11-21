package main

const k float32 = 1e40 // ERROR "cannot use 1e40 (untyped float constant 1e+40) as float32 value in constant declaration (overflows)"

func main() {
	_ = k
}
