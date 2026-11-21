package main

func main() {
	var a int32 = 1
	var b int64 = a // ERROR "cannot use a (variable of type int32) as int64 value in variable declaration"
	_ = b
}
