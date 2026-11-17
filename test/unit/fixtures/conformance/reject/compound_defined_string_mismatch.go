package main

type S string

func main() {
	var a S = "x"
	var t string = "y"
	a += t // ERROR "invalid operation: a += t (mismatched types S and string)"
}
