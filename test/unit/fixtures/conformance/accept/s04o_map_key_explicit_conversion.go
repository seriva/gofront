// targets: js both
// wasm is excluded: anonymous struct map keys miss on wasm (see plans/follow-ups.md).
package main

import "fmt"

type A struct{ X int }

func main() {
	a := A{42}
	k := struct{ X int }(a)
	m := map[struct{ X int }]int{struct{ X int }(a): 10}
	m[struct{ X int }(a)] += 5
	v, ok := m[k]
	fmt.Println(m[k], v, ok, len(m))
	delete(m, k)
	fmt.Println(len(m))
}

// Output:
// 15 15 true 1
// 0
