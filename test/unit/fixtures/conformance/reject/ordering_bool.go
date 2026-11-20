package main

func main() {
	b := true
	_ = b < true // ERROR "invalid operation: b < true (operator < not defined on bool)"
}
