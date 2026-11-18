package main

type P struct{ X int }
type fmt int

func main() {
	type Q struct{ X int }
	P = P{}   // ERROR "cannot assign to P"
	Q = Q{}   // ERROR "cannot assign to Q"
	fmt = 2   // ERROR "cannot assign to fmt"
	_ = &fmt  // ERROR "cannot take address of fmt"
	_ = &P    // ERROR "cannot take address of P"
}
