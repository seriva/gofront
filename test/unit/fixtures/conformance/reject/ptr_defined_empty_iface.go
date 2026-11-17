package main

type B interface{}

func main() {
	var b B = 1
	p := &b
	var q *any = p // ERROR "cannot use B as any value"
	_ = q
}
