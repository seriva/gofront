package main

import "fmt"

type P struct {
	X int
	A [2]int
}

func mks() []int      { return []int{0, 0} }
func ptr(p *P) *P     { return p }
func mkm() map[string]int { return map[string]int{} }

func main() {
	m := map[string]int{}
	m["a"] = 1
	m["a"]++
	m["a"] += 2
	p := &P{}
	ptr(p).X = 1
	ptr(p).A[1] = 5
	s := mks()
	s[0] = 7
	mks()[1] = 3
	mkm()["z"] = 9
	pm := map[int]*P{1: {}}
	pm[1].X = 4
	arr := [2]int{}
	arr[1] = 2
	(*p).X += 1
	(p.X)++
	var q P
	q.A[0] = 8
	pa := &[2]int{}
	pa[1] = 6
	fmt.Println(m["a"], p.X, p.A, s, pm[1].X, arr, q.A, *pa)
}

// Output:
// 4 3 [0 5] [7 0] 4 [0 2] [8 0] [0 6]
