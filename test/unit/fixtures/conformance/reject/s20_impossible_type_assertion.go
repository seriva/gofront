// pending: S20
package main

type I interface{ M() }
type S struct{}

func main() {
	var i I
	_ = i.(S) // ERROR "impossible type assertion: i.(S)"
}
