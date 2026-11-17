package main

func main() {
	var a map[string]int
	var b map[string]string = a // ERROR "Cannot assign"
	_ = b
}
