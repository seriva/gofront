package main

type P struct{ X int }
type K [2]P
type K2 K

func main() {
	a := map[struct{ X int }]int{{1}: 1}
	b := map[[2]int]int{{1, 2}: 2}
	c := map[any]int{1: 3}
	d := map[*P]int{}
	e := map[K2]int{{{1}, {2}}: 4}
	var x, y K
	println(len(a), len(b), len(c), len(d), len(e), x == y)
}

// Output:
// 1 1 1 0 1 true
