package main

import "fmt"

type Arr [2]int

type Box[T any] struct{ v T }

func (b *Box[T]) Set(v T) { b.v = v }

type Num int

func (n *Num) Inc() { *n++ }

type Counter struct{ n int }

func (c *Counter) Inc() { c.n++ }

func main() {
	arr := [2]int{1, 2}
	n := 0
	for range &arr {
		n++
	}
	var a Arr
	p := &a
	for range p {
		n++
	}
	fmt.Println(n)

	var b Box[int]
	b.Set(1)
	q := &b
	q.Set(2)
	fmt.Println(b.v)

	var x Num
	(&x).Inc()
	fmt.Println(x)
	var c Counter
	pc := &c
	(*pc).Inc()
	(&c).Inc()
	fmt.Println(c.n)
}

// Output:
// 4
// 2
// 1
// 2
