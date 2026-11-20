package main

func main() {
	var x float32 = 1
	switch x {
	case 1.00000001:
	case 1.00000002: // ERROR "duplicate case"
	}
}
