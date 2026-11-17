package main

func main() {
	f := 5.5
	f %= 2.0 // ERROR "operator % not defined on f (variable of type float64)"
	_ = f
}
