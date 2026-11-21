package main

type A struct{ X int }
type B struct{ X int }

func main() {
	var a A
	var b B = a // ERROR ") as B value in variable declaration"
	_ = b
}
