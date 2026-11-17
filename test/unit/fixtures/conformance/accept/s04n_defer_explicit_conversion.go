package main

import "fmt"

type A struct{ X int }

func checkTop(u struct{ X int }) { fmt.Println("top", u.X) }

func checkA(a A) { fmt.Println("A", a.X) }

func main() {
	a := A{42}
	u := struct{ X int }{43}
	defer checkTop(struct{ X int }(a))
	defer checkA(A(u))
	defer func(v struct{ X int }) { fmt.Println("lit", v.X) }(struct{ X int }(a))
	a.X = 1
	u.X = 2
	fmt.Println("body")
}

// Output:
// body
// lit 42
// A 43
// top 42
