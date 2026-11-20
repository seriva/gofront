package main

type S struct{ X int }

func main() {
	var s S
	_ = len(s) // ERROR "for built-in len"
}
