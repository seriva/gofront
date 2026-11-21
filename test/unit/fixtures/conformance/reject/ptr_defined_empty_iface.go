package main

type B interface{}

func main() {
	var b B = 1
	p := &b
	var q *any = p // ERROR "cannot use p (variable of type *B) as *any value in variable declaration"
	_ = q
}
