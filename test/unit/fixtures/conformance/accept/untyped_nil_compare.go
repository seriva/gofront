package main

import "fmt"

type I interface{ M() }

func f[T interface{ *int | []int }]() T { return nil }

func g[T interface{ ~[]int | ~map[string]int }](x T) bool { return x == nil }

func main() {
	var p *int
	var s []int
	var m map[string]int
	var fn func()
	var i I
	var e error
	fmt.Println(p == nil, s == nil, m == nil, fn == nil, i == nil, e == nil, nil == p)
	fmt.Println(f[*int]() == nil, g(s))
	var r rune = 'a'
	var b byte = 'a'
	fmt.Println(r == 'a', b == 'a', 'a' == r)
}

// Output:
// true true true true true true true
// true true
// true true true
