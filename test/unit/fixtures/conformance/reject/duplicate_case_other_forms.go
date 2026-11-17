package main

const one = 1

func main() {
	x := 1
	switch x {
	case 1, 0x1: // ERROR "duplicate case 0x1 in expression switch"
	case one: // ERROR "duplicate case one in expression switch"
	}
	var f float64
	switch f {
	case 2:
	case 2.0: // ERROR "duplicate case 2 in expression switch"
	}
	switch "a" {
	case "a":
	case "a": // ERROR "duplicate case \"a\" in expression switch"
	}
}
