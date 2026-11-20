package main

import . "./sub"

func main() {
	Fn = nil    // ERROR "cannot assign to Fn (neither addressable nor a map index expression)"
	_ = &Fn     // ERROR "cannot take address of Fn"
	Box = Box{} // ERROR "cannot assign to Box (neither addressable nor a map index expression)"
	C = 2       // ERROR "cannot assign to C (neither addressable nor a map index expression)"
}
