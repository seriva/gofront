package main

import "fmt"

type A struct{ X int }

func show(s struct{ X int }) int { return s.X }

func make1() struct{ X int } { return A{7} }

func back(s struct{ X int }) A { return s }

func main() {
	a := A{1}
	fmt.Println(show(a))
	fmt.Println(make1().X)
	var u struct{ X int } = struct{ X int }{3}
	b := back(u)
	b.X = 9
	fmt.Println(u.X, b.X)
	c := a
	var d struct{ X int } = c
	d.X = 5
	fmt.Println(a.X, c.X, d.X)
	list := []struct{ X int }{a, A{2}}
	fmt.Println(list[0].X, list[1].X)
}

// Output:
// 1
// 7
// 3 9
// 1 1 5
// 1 2
