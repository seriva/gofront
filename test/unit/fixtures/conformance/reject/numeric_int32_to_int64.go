package main

func main() {
	var a int32 = 1
	var b int64 = a // ERROR "Cannot assign"
	_ = b
}
