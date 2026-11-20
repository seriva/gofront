package main

func main() {
	var a []int
	var b []string = a // ERROR "cannot use"
	_ = b
}
