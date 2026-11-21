package main

func main() {
	var a struct{ X int }
	var b struct{ Y string }
	a = b // ERROR "cannot use b (variable of type struct{Y string}) as struct{X int} value in assignment"
	_ = a
}
