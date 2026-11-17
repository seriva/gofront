package main

import "fmt"

type A struct{ X int }

type Getter interface{ Get() int }

func (a A) Get() int { return a.X }

func main() {
	a := A{42}
	var u struct{ X int } = a
	var x any = u
	_, ok := x.(A)
	_, ok2 := x.(Getter)
	c, ok3 := x.(struct{ X int })
	fmt.Println(ok, ok2, ok3, c.X)
}

// Output:
// false false true 42
