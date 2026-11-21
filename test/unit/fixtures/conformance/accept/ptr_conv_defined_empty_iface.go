package main

import "fmt"

type B interface{}

func main() {
	var v any = 7
	var b B = v
	p := &b
	q := (*any)(p)
	r := (*B)(q)
	fmt.Println(*q, *r)
}

// Output:
// 7 7
