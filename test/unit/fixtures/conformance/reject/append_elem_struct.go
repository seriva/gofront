package main

func main() {
	var s []struct{ X int }
	s = append(s, struct{ Y string }{"a"}) // ERROR "in argument to append"
	_ = s
}
