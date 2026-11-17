// targets: js
package main

import (
	"fmt"
	"os"
)

var counter int
var handler func() string

type P struct{ X int }

func (p *P) Inc() { p.X++ }

func f[T ~[2]int](a T) T {
	a[0] = 1
	return a
}

func g[T ~map[string]int](m T) { m["a"] = 1 }

func main() {
	old := os.Stdout
	os.Stdout = old
	counter = 2
	counter++
	handler = func() string { return "ok" }
	fmt.Println(counter, handler(), old == os.Stdout)
	p := P{}
	p.Inc()
	arr := [2]int{}
	arr = f(arr)
	m := map[string]int{}
	g(m)
	fmt.Println(arr[0], m["a"], p.X)
}
// Output:
// 3 ok true
// 1 1 1
