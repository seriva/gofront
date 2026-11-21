package main

func main() {
	var s []struct{ X int }
	s = append(s, struct{ Y string }{"a"}) // ERROR "cannot use struct{Y string}{…} (value of type struct{Y string}) as struct{X int} value in argument to append"
	_ = s
}
