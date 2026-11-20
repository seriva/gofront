package main

type P struct{ X int }

func mk() P { return P{} }

func main() {
	_ = &mk() // ERROR "cannot take address of mk() (value of struct type P)"
}
