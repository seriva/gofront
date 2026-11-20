package main

type P struct{ S []int }
type N struct {
	X int
	P P
}

func main() {
	var a, b N
	println(a != b) // ERROR "struct containing P cannot be compared"
}
