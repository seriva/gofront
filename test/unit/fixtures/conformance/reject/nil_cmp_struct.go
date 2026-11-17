package main

type P struct{ X int }

func main() {
	var p P
	_ = p == nil // ERROR "mismatched types P and untyped nil"
}
