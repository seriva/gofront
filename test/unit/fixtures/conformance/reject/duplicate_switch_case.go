package main

func main() {
	x := 1
	switch x {
	case 1:
	case 1: // ERROR "duplicate case 1 (constant of type int) in expression switch"
	}
}
