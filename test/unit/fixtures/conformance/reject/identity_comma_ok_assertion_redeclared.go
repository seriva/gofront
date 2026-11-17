package main

type A struct{ X int }

func main() {
	var x any = A{11}
	var u struct{ X int }
	u, ok := x.(A) // ERROR "convert it explicitly"
	_, _ = u, ok
}
