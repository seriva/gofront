package main

type P struct{ A [2][]int }

func main() {
	var m map[P]string // ERROR "invalid map key type P"
	_ = m
}
