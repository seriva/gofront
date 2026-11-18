package main

func main() {
	const k = 2.0
	for i := range k { // ERROR "cannot range over k (untyped float constant 2)"
		_ = i
	}
}
