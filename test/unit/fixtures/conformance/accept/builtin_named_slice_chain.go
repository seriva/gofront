// targets: js, both
package main

import "fmt"

type S1 []int
type S2 S1

func sum(xs ...int) int {
	t := 0
	for _, x := range xs {
		t += x
	}
	return t
}

func main() {
	s := S2{1, 2}
	s = append(s, 3)
	a := append([]int{0}, s...)
	fmt.Println(sum(s...), len(a), len(s))
	var arr [3]int
	p := &arr
	fmt.Println(len(p), len("hello"))
}

// Output:
// 6 4 3
// 3 5
