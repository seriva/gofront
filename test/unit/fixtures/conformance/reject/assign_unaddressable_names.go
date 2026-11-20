package main

import (
	"fmt"
	"math"
)

type P struct{ X int }

func (p *P) Inc() {}
func (p P) M()    {}

type I interface{ M() }

func foo() {}

func mk() P { return P{} }

func main() {
	foo = nil // ERROR "cannot assign to foo (neither addressable nor a map index expression)"
	_ = &foo  // ERROR "cannot take address of foo"
	_ = &fmt  // ERROR "cannot take address of fmt"
	math.Pi = 3.0 // ERROR "cannot assign to math.Pi (neither addressable nor a map index expression)"
	math.Pi++ // ERROR "cannot assign to math.Pi (neither addressable nor a map index expression)"
	_ = &math.Pi // ERROR "cannot take address of math.Pi"
	var p P
	p.M = func() {} // ERROR "cannot assign to p.M (neither addressable nor a map index expression)"
	var i I
	i.M = nil // ERROR "cannot assign to i.M (neither addressable nor a map index expression)"
	P.M = nil // ERROR "cannot assign to P.M (neither addressable nor a map index expression)"
	_ = &p.Inc // ERROR "cannot take address of p.Inc"
	_ = &P.M // ERROR "cannot take address of P.M"
}
