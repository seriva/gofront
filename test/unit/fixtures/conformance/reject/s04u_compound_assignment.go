package main

type A struct{ X int }

func main() {
	a := A{1}
	var u struct{ X int }
	u += a // ERROR "Cannot assign A to struct"
	_ = u
}
