package main

type A = any

func main() {
	_ = A(2) + 1 // ERROR "operator + not defined on"
}
