package main

import "fmt"

type S struct{}

func (S) M() {}

type I interface{ M() }
type A I

type F func()
type G F

func main() {
	var a A
	_, ok := a.(S)
	var c A = S{}
	_, ok2 := c.(S)
	fmt.Println(ok, ok2)
	var g G = func() { fmt.Println("hi") }
	g()
}

// Output:
// false true
// hi
