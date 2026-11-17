package main

func main() {
	var v interface{} = 2
	_ = v * 2 // ERROR "operator * not defined"
}
