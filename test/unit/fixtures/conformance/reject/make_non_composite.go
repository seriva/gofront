package main

type P struct{}

func main() {
	_ = make(int, 1)    // ERROR "cannot make int: type must be slice, map, or channel"
	_ = make(string, 1) // ERROR "cannot make string: type must be slice, map, or channel"
	_ = make(any, 1)    // ERROR "cannot make any: type must be slice, map, or channel"
	_ = make(P, 1)      // ERROR "cannot make P: type must be slice, map, or channel"
	_ = make([2]int, 1) // ERROR "cannot make [2]int: type must be slice, map, or channel"
}
