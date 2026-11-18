package main

import "fmt"

type List[T any] []T
type IntList List[int]
type Wrap[T any] List[T]

type Pair[K comparable, V any] struct {
	Key K
	Val V
}
type SI Pair[string, int]

func (p SI) Name() string { return p.Key }

func main() {
	l := IntList{1, 2}
	l = append(l, 3)
	w := Wrap[int]{4, 5}
	w = append(w, 6)
	s := SI{Key: "a", Val: 1}
	fmt.Println(len(l), l[2], len(w), w[2], s.Name(), s.Val)
}

// Output:
// 3 3 3 6 a 1
