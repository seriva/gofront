package main

type A struct{ X int }

func checkTop(u struct{ X int }) {}

func checkA(a A) {}

func main() {
	a := A{42}
	u := struct{ X int }{42}
	defer checkTop(a) // ERROR "Cannot assign A to struct{...} here"
	defer checkA(u)   // ERROR "Cannot assign struct{...} to A here"
}
