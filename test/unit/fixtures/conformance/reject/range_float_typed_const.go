package main

func main() {
	const k float64 = 2
	for i := range k { // ERROR "cannot range over k (variable of type float64)"
		_ = i
	}
}
