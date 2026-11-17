// pending: S19
package main

type S struct {
	A int
	B string
}

func main() {
	_ = S{1} // ERROR "too few values in struct literal of type S"
}
