package main

type P struct{ X int }
type Celsius float64

func main() {
	f := 2.5
	for range f { // ERROR "cannot range over f (variable of type float64)"
	}
	var c Celsius
	for range c { // ERROR "cannot range over c (variable of type Celsius)"
	}
	p := P{1}
	for range p { // ERROR "cannot range over p (variable of type P)"
	}
	for range true { // ERROR "cannot range over true (untyped bool constant)"
	}
}
