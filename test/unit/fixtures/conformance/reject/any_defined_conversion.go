package main

type MyAny any
type B interface{}

func main() {
	var v MyAny = 2
	var b B = 3
	var e interface{} = 4
	_ = int(v)             // ERROR "need type assertion"
	_ = float64(b)         // ERROR "need type assertion"
	_ = bool(e)            // ERROR "need type assertion"
	_ = string(v)          // ERROR "need type assertion"
	_ = struct{ X int }(b) // ERROR "need type assertion"
}
