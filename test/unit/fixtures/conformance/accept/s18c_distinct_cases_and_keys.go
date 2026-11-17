package main

import "fmt"

type S struct {
	A int
	B string
}

type E struct{ S }

func pick(x any) string {
	switch x {
	case 1:
		return "int"
	case 1.0:
		return "float"
	case "1":
		return "string"
	case int8(1):
		return "int8"
	}
	return "other"
}

func main() {
	a, b := 2, 2
	n := 2
	switch n {
	case a:
		fmt.Println("a")
	case b:
		fmt.Println("b")
	case 3:
	}
	switch {
	case n > 1:
		fmt.Println("gt")
	case n > 1:
		fmt.Println("again")
	case true:
	case true:
	}
	fmt.Println(pick("1"), pick(true))
	mixed := map[any]int{1: 1, 1.0: 2, "1": 3, int8(1): 4, true: 5}
	fmt.Println(mixed != nil)
	k := "x"
	m2 := map[string]int{k: 1, "x": 2, "y": 3}
	fmt.Println(len(m2))
	_ = S{1, "a"}
	_ = S{A: 1}
	_ = S{}
	_ = E{S{1, "b"}}
	_ = E{S: S{}}
	_ = struct{}{}
	fmt.Println(S{1, "z"}, E{})
}

// Output:
// a
// gt
// string other
// true
// 2
// {1 z} {{0 }}
