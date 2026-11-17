package main

import "fmt"

type A struct{ X int }

func main() {
	var x any = A{11}
	m := map[string]A{"k": {12}}
	var u struct{ X int }

	a, ok := x.(A)
	u = struct{ X int }(a)
	fmt.Println(u.X, ok)

	b, ok := m["k"]
	u = struct{ X int }(b)
	fmt.Println(u.X, ok)
}

// Output:
// 11 true
// 12 true
