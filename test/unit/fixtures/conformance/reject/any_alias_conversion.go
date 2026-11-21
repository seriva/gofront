package main

type A = any

func main() {
	_ = A(2) + 1 // ERROR "A(2) + 1 (mismatched types"
}
