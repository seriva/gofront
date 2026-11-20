package main

type P struct{ S []int }

func main() {
	var i any
	var p P
	println(i == p) // ERROR "struct containing []int cannot be compared"
}
