package main

type S struct{ X int }

func main() {
	_ = len.Foo // ERROR "invalid use of len (built-in) in selector expression"
	_ = S.X     // ERROR "S.X undefined (type S has no method X)"
}
