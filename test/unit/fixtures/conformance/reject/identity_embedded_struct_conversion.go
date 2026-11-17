package main

type E struct{ V int }
type A struct{ E }

func main() {
	a := A{E{11}}
	var u struct{ E } = a // ERROR "Cannot assign A to struct{...} here"
	var b A = u           // ERROR "Cannot assign struct{...} to A here"
	_, _ = u, b
}
