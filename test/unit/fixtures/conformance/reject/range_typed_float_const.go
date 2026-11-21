package main

const limit float64 = 2

func main() {
	const half float32 = 1.5
	for i := range limit { // ERROR "cannot range over limit (constant 2 of type float64)"
		_ = i
	}
	for i := range half { // ERROR "cannot range over half (constant 1.5 of type float32)"
		_ = i
	}
}
