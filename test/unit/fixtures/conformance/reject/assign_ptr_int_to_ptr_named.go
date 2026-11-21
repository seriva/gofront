package main

type MyInt int

func main() {
	var p *int
	var q *MyInt = p // ERROR "cannot use p (variable of type *int) as *MyInt value in variable declaration"
	_ = q
}
