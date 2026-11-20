package main

type P struct{ X int }

func f[T ~[2]int](mk func() T) {
	mk()[0] = 1 // ERROR "cannot assign to mk()[0] (neither addressable nor a map index expression)"
}

func g[T ~map[string]P](m T) {
	m["a"].X = 1 // ERROR "cannot assign to struct field m[\"a\"].X in map"
}

func main() {}
