package main

type P struct{ X int }

func main() {
	m := map[string]P{"a": {1}}
	m["a"].X = 2 // ERROR "cannot assign to struct field m[\"a\"].X in map"
}
