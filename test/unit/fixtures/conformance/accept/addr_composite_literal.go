package main

import "fmt"

type P struct{ X int }

func main() {
	p := &P{X: 1}
	q := &(P{X: 2})
	s := &[]int{1}
	fmt.Println(p.X, q.X, *s)
}

// Output:
// 1 2 [1]
