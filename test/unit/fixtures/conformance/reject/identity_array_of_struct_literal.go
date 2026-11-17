package main

type A struct{ X int }

func main() {
	a := [1]A{{1}}
	var b [1]struct{ X int } = a // ERROR "Cannot assign"
	_ = b
}
