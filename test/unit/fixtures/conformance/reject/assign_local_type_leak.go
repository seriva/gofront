package main

func f() {
	type Q struct{ X int }
}

func main() {
	Q = Q{} // ERROR "Undefined: 'Q'"
	_ = &Q // ERROR "Undefined: 'Q'"
}
