package main

type B interface{}

func (b B) Foo() int { return 1 } // ERROR "invalid receiver type B (pointer or interface type)"

func main() {}
