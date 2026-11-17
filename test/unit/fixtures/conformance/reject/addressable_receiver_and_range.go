package main

type Box[T any] struct{ v T }

func (b *Box[T]) Set(v T) { b.v = v }

func mkBox() Box[int] { return Box[int]{} }

type Num int

func (n *Num) Inc() { *n++ }

type P struct{ X int }
type M1 map[string]P
type M2 M1

func main() {
	Box[int]{}.Set(1) // ERROR "cannot call pointer method Set on Box[int]"
	mkBox().Set(1) // ERROR "cannot call pointer method Set on Box[int]"
	fn := Box[int]{}.Set // ERROR "cannot call pointer method Set on Box[int]"
	_ = fn
	var a, b Num
	(a + b).Inc() // ERROR "cannot call pointer method Inc on Num"
	(-a).Inc() // ERROR "cannot call pointer method Inc on Num"
	m := M2{}
	m["a"].X = 1 // ERROR "cannot assign to struct field m[\"a\"].X in map"
	n := 1
	for range &n { // ERROR "cannot range over &n (value of type *int)"
	}
}
