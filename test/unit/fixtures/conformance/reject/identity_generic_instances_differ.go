package main

type Box[T any] struct{ V T }

func main() {
	var a Box[int]
	var b Box[string]
	a = b // ERROR ") as Box[int] value in assignment"
	_ = a
}
