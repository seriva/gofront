package main

func f() {
	type Q struct{ X int }
}

func main() {
	Q = Q{} // ERROR "cannot assign to Q"
	_ = &Q // ERROR "cannot take address of Q"
}
