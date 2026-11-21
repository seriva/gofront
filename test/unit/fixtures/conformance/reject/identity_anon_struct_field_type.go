package main

func main() {
	var a struct{ X int }
	var b struct{ X string }
	a = b // ERROR "cannot use b (variable of type struct{X string}) as struct{X int} value in assignment"
	_ = a
}
