package main

func f() {
	type Q struct{ X int }
	_ = Q{}
}

func main() {
	var q Q // ERROR "Unknown type 'Q'"
	_ = q
}
