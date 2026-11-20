package main

func main() {
	f := 1.5
	_ = ^f   // ERROR "operator ^ not defined on f (variable of type float64)"
	_ = ^1.5 // ERROR "operator ^ not defined on 1.5 (untyped float constant)"
}
