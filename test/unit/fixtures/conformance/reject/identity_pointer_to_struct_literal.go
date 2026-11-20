package main

type A struct{ X int }

func main() {
	a := &A{1}
	var p *struct{ X int } = a // ERROR "cannot use"
	_ = p
}
