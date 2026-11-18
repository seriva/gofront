package main

func main() {
	const n = 3.0
	for i := range n { // ERROR "cannot range over n (untyped float constant)"
		_ = i
	}
}
