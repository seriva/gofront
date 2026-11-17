package main

type A struct{ X int }

func main() {
	m := map[string]A{"k": {1}}
	var u struct{ X int }
	var ok bool
	u, ok = m["k"] // ERROR "convert it explicitly"
	_, _ = u, ok
}
