package main

func main() {
	var a int32 = 1
	var b int64 = 2
	_ = a + b // ERROR "mismatched types int32 and int64"
}
