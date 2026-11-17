package main

func main() {
	var s []int
	s = append(s, "a") // ERROR "Cannot assign untyped string to int"
	_ = s
}
