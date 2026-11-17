package main

import "fmt"

type Num interface{ ~int | ~float64 }

func Sum[T Num](xs []T) T {
	var t T
	for _, x := range xs {
		t += x
	}
	return t
}

func Id[T any](x T) T { return x }

func Pair[T any](a, b T) bool { return any(a) == any(b) }

type Box[T any] struct{ v T }

func (b Box[T]) Get() T { return b.v }

func main() {
	fmt.Println(Sum([]int{1, 2, 3}), Id(3)+1, Pair(1, 1))
	var v any = 2
	fmt.Println(v == 2, v != nil, 2 == v)
	b := Box[any]{v: 3}
	if n, ok := b.Get().(int); ok {
		fmt.Println(n + 1)
	}
	switch x := v.(type) {
	case int:
		fmt.Println(x * 2)
	case string, bool:
		fmt.Println(x)
	default:
		fmt.Println(x)
	}
	var e interface{} = 5
	fmt.Println(e == 5)
	m := map[string]any{"a": 1}
	if n, ok := m["a"].(int); ok {
		n++
		n += 2
		fmt.Println(n)
	}
	fmt.Println(Id[any](4) == 4)
	var w any
	w = Id(w)
	fmt.Println(w == nil)
}

// Output:
// 6 4 true
// true true true
// 4
// 4
// true
// 4
// true
// true
