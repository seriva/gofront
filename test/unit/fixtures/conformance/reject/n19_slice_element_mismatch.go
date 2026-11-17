package main

func main() {
	var a []int
	var b []string = a // ERROR "Cannot assign"
	_ = b
}
