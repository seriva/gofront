package main

import "fmt"

type A struct{ X int }

func (a A) Get() int    { return a.X }
func (a A) Add(b A) int { return a.X + b.X }

func main() {
	a := A{1}
	u := struct{ X int }{2}
	fmt.Println(A.Get(u), A.Add(u, a), A.Add(a, u))
	f := A.Get
	fmt.Println(f(u))
	u.X = 5
	fmt.Println(A.Get(u), a.X)
}

// Output:
// 2 3 3
// 2
// 5 1
