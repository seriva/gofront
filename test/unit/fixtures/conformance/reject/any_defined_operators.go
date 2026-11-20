package main

type MyAny any
type B interface{}

func main() {
	var v MyAny = 2
	var b B = 3
	var e interface{} = 4
	_ = v < 2    // ERROR "operator < not defined on v"
	_ = v && true // ERROR "operator && not defined on v"
	_ = ^v       // ERROR "operator ^ not defined on v"
	_ = -b       // ERROR "operator - not defined on b"
	_ = e + 1    // ERROR "operator + not defined on e"
	_ = !e       // ERROR "operator ! not defined on e"
}
