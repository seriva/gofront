package main

type P struct{ X int }

func main() {
	_ = P // ERROR "P (type) is not an expression"
}
