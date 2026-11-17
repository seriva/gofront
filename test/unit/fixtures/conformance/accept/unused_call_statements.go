package main

import "fmt"

type C struct{ n int }

func (c *C) Inc() { c.n++ }

func two() (int, string) { return 1, "a" }

func main() {
	c := &C{}
	c.Inc()
	(c.Inc)()
	func() { c.n++ }()
	two()
	(two())
	m := map[string]int{"a": 1}
	delete(m, "a")
	dst := make([]int, 2)
	copy(dst, []int{7, 8})
	defer func() {
		recover()
		fmt.Println("recovered")
	}()
	fmt.Println(c.n, dst, len(m))
	panic("boom")
}

// Output:
// 3 [7 8] 0
// recovered
