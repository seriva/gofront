package main

import "fmt"

type A struct {
	X int `json:"x"`
}

func main() {
	a := A{4}
	c := struct{ X int }(a)
	back := A(c)
	fmt.Println(c.X, back.X)
}

// Output:
// 4 4
