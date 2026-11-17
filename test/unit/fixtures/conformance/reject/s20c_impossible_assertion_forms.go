package main

type I interface{ M() }
type S struct{}
type P struct{}

func (*P) M() {}

type Er struct{}

func main() {
	var i I
	_, _ = i.(S) // ERROR "impossible type assertion: i.(S)"
	_ = i.(P)    // ERROR "impossible type assertion: i.(P)"
	_ = i.(int)  // ERROR "impossible type assertion: i.(int)"
	var e error
	_ = e.(Er) // ERROR "impossible type assertion: e.(Er)"
	switch i.(type) {
	case P: // ERROR "impossible type switch case"
	case *P, S: // ERROR "impossible type switch case"
	}
}
