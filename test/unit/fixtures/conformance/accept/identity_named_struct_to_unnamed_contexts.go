package main

import "fmt"

type A struct{ X int }

type Getter interface{ Get() int }

func (a A) Get() int { return a.X }

type H struct{ U struct{ X int } }

func take(u struct{ X int }) any { return u }

func ret(a A) struct{ X int } { return a }

func main() {
	a := A{42}
	var h H
	h.U = a
	var x any = h.U
	_, ok := x.(A)
	y := take(a)
	_, ok2 := y.(Getter)
	z := ret(a)
	a.X = 7
	var w any = z
	_, ok3 := w.(A)
	fmt.Println(ok, ok2, ok3, h.U.X, z.X)
}

// Output:
// false false false 42 42
