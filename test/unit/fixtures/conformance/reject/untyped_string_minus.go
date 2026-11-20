package main

func main() {
	_ = "a" - "b"   // ERROR "operator - not defined on \"a\" (untyped string constant)"
	_ = true + true // ERROR "operator + not defined on true (untyped bool constant)"
}
