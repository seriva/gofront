package main

type P struct{ S []int }

func main() {
	var a, b P
	println(a == b) // ERROR "struct containing []int cannot be compared"
}
