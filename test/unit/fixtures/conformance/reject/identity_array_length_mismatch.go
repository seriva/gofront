package main

func main() {
	var a [2]int
	var b [3]int
	a = b // ERROR "cannot use"
	_ = a
}
