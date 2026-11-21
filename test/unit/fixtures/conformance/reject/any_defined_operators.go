package main

type MyAny any
type B interface{}

func main() {
	var v MyAny = 2
	var b B = 3
	var e interface{} = 4
	_ = v < 2    // ERROR "v < 2 (operator < not defined on interface)"
	_ = v && true // ERROR "v && true (mismatched types MyAny and bool)"
	_ = ^v       // ERROR "operator ^ not defined on v"
	_ = -b       // ERROR "operator - not defined on b"
	_ = e + 1    // ERROR "e + 1 (mismatched types interface{} and untyped int)"
	_ = !e       // ERROR "operator ! not defined on e"
}
