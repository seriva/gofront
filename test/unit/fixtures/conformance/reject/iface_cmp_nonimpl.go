package main

type I interface{ M() }
type P struct{}
type S []int

func (S) M() {}

func main() {
	var i I
	var p P
	var s S
	_ = i == p // ERROR "invalid operation: i == p (mismatched types I and P)"
	_ = i == s // ERROR "slice can only be compared to nil"
}
