package main

func main() {
	var p, q *int
	_ = p < q // ERROR "invalid operation: p < q (operator < not defined on pointer)"
}
