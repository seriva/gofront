package main

type P struct{ X int }

func main() {
	var p, q P
	_ = p < q // ERROR "invalid operation: p < q (operator < not defined on struct)"
}
