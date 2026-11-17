package main

import (
	"fmt"
	"iter"
)

type Count int
type Names []string
type Table map[string]int

func gen(yield func(int) bool) {
	for i := 0; i < 2; i++ {
		if !yield(i) {
			return
		}
	}
}

func pairs() iter.Seq2[string, int] {
	return func(yield func(string, int) bool) { yield("k", 7) }
}

func each[T ~[]E, E any](xs T) int {
	n := 0
	for range xs {
		n++
	}
	return n
}

func main() {
	var n Count = 2
	for i := range 3 {
		fmt.Printf("%v ", i)
	}
	for i := range n {
		fmt.Printf("%v ", i)
	}
	for i := range uint8(2) {
		fmt.Printf("%v ", i)
	}
	for range 2 {
		fmt.Print("x ")
	}
	for i, r := range "hé" {
		fmt.Printf("%v:%c ", i, r)
	}
	for i, v := range []int{5, 6} {
		fmt.Printf("%v:%v ", i, v)
	}
	for i, v := range [2]int{7, 8} {
		fmt.Printf("%v:%v ", i, v)
	}
	arr := [2]int{1, 2}
	for i, v := range &arr {
		fmt.Printf("%v:%v ", i, v)
	}
	for k, v := range (Table{"a": 1}) {
		fmt.Printf("%v:%v ", k, v)
	}
	for i, s := range (Names{"n"}) {
		fmt.Printf("%v:%v ", i, s)
	}
	for v := range gen {
		fmt.Printf("%v ", v)
	}
	for k, v := range pairs() {
		fmt.Printf("%v:%v ", k, v)
	}
	fmt.Println(each(Names{"a", "b"}))
}

// Output:
// 0 1 2 0 1 0 1 x x 0:h 1:é 0:5 1:6 0:7 1:8 0:1 1:2 a:1 0:n 0 1 k:7 2