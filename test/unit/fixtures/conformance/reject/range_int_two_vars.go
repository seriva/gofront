package main

func main() {
	for i, v := range 3 { // ERROR "range over 3 (untyped int constant) permits only one iteration variable"
		_, _ = i, v
	}
}
