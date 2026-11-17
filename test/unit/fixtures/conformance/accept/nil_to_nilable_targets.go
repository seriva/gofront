package main

import "fmt"

type Node struct{ next *Node }
type IntList []int
type Table map[string]int
type Handler func()
type Shape interface{ Area() float64 }
type Box[T any] struct{ v T }

func zero[T any]() T {
	var z T
	return z
}

func orNil[T any](p *T) *T { return p }

func takes(p *int, s []int, m map[string]int, f func(), e error, a any, sh Shape) string {
	return fmt.Sprint(p == nil, s == nil, m == nil, f == nil, e == nil, a == nil, sh == nil)
}

func ret() (*int, []int, error) { return nil, nil, nil }

func main() {
	var p *int = nil
	var s []int = nil
	var m map[string]int = nil
	var f func() = nil
	var e error = nil
	var a any = nil
	var sh Shape = nil
	var il IntList = nil
	var t Table = nil
	var h Handler = nil
	var n *Node = &Node{next: nil}
	var js any
	js = nil
	fmt.Println(p == nil, s == nil, m == nil, f == nil, e == nil, a == nil, sh == nil)
	fmt.Println(il == nil, t == nil, h == nil, n.next == nil, js == nil)
	fmt.Println(takes(nil, nil, nil, nil, nil, nil, nil))
	r1, r2, r3 := ret()
	fmt.Println(r1 == nil, r2 == nil, r3 == nil)
	fmt.Println(orNil[int](nil) == nil, zero[*int]() == nil, zero[[]int]() == nil)
	b := Box[*int]{v: nil}
	fmt.Println(b.v == nil)
	m2 := map[string]*int{"a": nil}
	fmt.Println(m2["a"] == nil, len([]any{nil, nil}))
}

// Output:
// true true true true true true true
// true true true true true
// true true true true true true true
// true true true
// true true true
// true
// true 2
