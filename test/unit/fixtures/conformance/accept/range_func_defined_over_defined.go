package main

import "fmt"

type Seq func(func(int) bool)
type Seq2 Seq

type F func()
type G F

func main() {
	var s Seq2 = func(yield func(int) bool) {
		if !yield(1) {
			return
		}
		yield(2)
	}
	for v := range s {
		fmt.Println(v)
	}
	var g G = func() { fmt.Println("hi") }
	g()
}

// Output:
// 1
// 2
// hi
