// compile-only
// targets: js
package main

type I interface{ M() }
type T struct{ X int }

func (T) M() {}

func main() {
	var i I
	var t T
	_ = i == t
	_ = t == i
	_ = i != t
	var e error
	var j any
	_ = e == nil
	_ = j == 1
	_ = j == e
}
