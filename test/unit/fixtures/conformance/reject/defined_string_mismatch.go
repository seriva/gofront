package main

type S string

func main() {
	var s S = "a"
	var t string = "b"
	_ = s + t // ERROR "mismatched types S and string"
}
