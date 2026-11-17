package main

type Fooer interface{ Foo() int }
type Barer interface{ Bar() string }

func main() {
	var a Fooer
	var b Barer = a // ERROR "Fooer does not implement Barer"
	_ = b
}
