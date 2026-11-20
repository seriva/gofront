package main

func main() {
	c := 0
	for range 1e3 { // ERROR "cannot range over 1e3 (untyped float constant)"
		c++
	}
	_ = c
}
