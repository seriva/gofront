package main

func main() {
	var v, w any
	_ = v + w // ERROR "operator + not defined on v"
	_ = v + nil // ERROR "v + nil (mismatched types any and untyped nil)"
}
