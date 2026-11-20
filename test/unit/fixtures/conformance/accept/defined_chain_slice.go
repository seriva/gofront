package main

import "fmt"

type A B
type B C
type C []int

func main() {
	var s A = A{1, 2}
	fmt.Println(len(s))
	s = append(s, 3)
	total := 0
	for _, v := range s {
		total += v
	}
	fmt.Println(total, s[0], len([]int(s)))
}

// Output:
// 2
// 6 1 3
