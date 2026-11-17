package main

import "fmt"

type A struct{ X int }

type Getter interface{ Get() int }

func (a A) Get() int { return a.X }

func main() {
	a := A{1}
	u := struct{ X int }{2}
	u, a = a, u
	fmt.Println(u.X, a.X)

	var x any = u
	var y any = a
	_, ok := x.(A)
	_, ok2 := y.(A)
	_, ok3 := x.(Getter)
	fmt.Println(ok, ok2, ok3)

	a.X = 9
	fmt.Println(u.X)
	u.X = 8
	fmt.Println(a.X)

	b := A{3}
	var v struct{ X int }
	v, b = b, v
	fmt.Println(v.X, b.X)
}

// Output:
// 1 2
// false true false
// 1
// 9
// 3 0
