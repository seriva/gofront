package main

type C struct{ n int }

func (c *C) Inc() { c.n++ }

func mk() C { return C{} }

func main() {
	mk().Inc() // ERROR "cannot call pointer method Inc on C"
}
