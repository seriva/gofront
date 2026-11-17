package main

import "fmt"

type Fooer interface{ Foo() int }

type T struct{}

func (T) Foo() int { return 7 }

func main() {
	var a interface{ Foo() int } = T{}
	var b Fooer = a
	fmt.Println(b.Foo())
}

// Output:
// 7
