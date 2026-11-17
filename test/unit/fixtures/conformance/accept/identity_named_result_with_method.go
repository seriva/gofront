package main

import "fmt"

type A struct{ X int }

func (a A) Get() int { return a.X }

func build(u struct{ X int }) (r A) {
	return u
}

func main() {
	r := build(struct{ X int }{5})
	fmt.Println(r.Get())
	f := func(u struct{ X int }) (r A) { return u }
	fmt.Println(f(struct{ X int }{6}).Get())
}

// Output:
// 5
// 6
