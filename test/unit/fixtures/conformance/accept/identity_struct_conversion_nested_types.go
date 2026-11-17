package main

import "fmt"

type In struct{ N int }
type A struct {
	X  int
	In In
	S  []string
	M  map[string][2]int
	P  *In
}

func conv[T any](v T) T { return v }

func gen[T any](a A, v T) struct {
	X  int
	In In
	S  []string
	M  map[string][2]int
	P  *In
} {
	return a
}

func main() {
	type L struct{ Y int }
	l := L{4}
	var lu struct{ Y int } = l
	var l2 L = lu
	a := A{X: 1, In: In{2}, S: []string{"s"}, M: map[string][2]int{"k": {1, 2}}, P: &In{7}}
	var u struct {
		X  int
		In In
		S  []string
		M  map[string][2]int
		P  *In
	} = a
	fmt.Println(lu.Y, l2.Y, u.X, u.In.N, u.S, u.M, u.P.N)
	g := gen(a, 5)
	fmt.Println(g.X, conv(a).X)
	var a2 A = u
	fmt.Println(a2.X)
}

// Output:
// 4 4 1 2 [s] map[k:[1 2]] 7
// 1 1
// 1
