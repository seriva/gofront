package main

func main() {
	var a []int
	var b []any = a // ERROR "cannot use a (variable of type []int) as []any value in variable declaration"
	_ = b
	var m map[string]int
	var n map[string]any = m // ERROR "cannot use m (variable of type map[string]int) as map[string]any value in variable declaration"
	_ = n
	var f func() int
	var g func() any = f // ERROR "cannot use f (variable of type func() int) as func() any value in variable declaration"
	_ = g
}
