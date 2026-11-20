package main

func main() {
	var m map[[]int]int // ERROR "invalid map key type []int"
	_ = m
}
