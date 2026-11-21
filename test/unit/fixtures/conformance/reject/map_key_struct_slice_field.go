package main

type P struct{ S []int }

type Q struct{ M map[P]int } // ERROR "invalid map key type P"

func main() {
	var q Q
	_ = q
}
