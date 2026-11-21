package main

func main() {
	var p *int
	var q *any = p // ERROR "cannot use p (variable of type *int) as *any value in variable declaration"
	_ = q
}
