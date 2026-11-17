package main

import "fmt"

type A struct{ X int }

func (a A) Get() int { return a.X }

func main() {
	u := struct{ X int }{42}
	var a A = u
	fmt.Println(a.Get())
	var x any = a
	b, ok := x.(A)
	fmt.Println(ok, b.X)
	a.X = 1
	fmt.Println(u.X, a.X)
}

// Output:
// 42
// true 42
// 42 1
