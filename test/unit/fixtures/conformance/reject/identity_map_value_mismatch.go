package main

func main() {
	var a map[string]int
	var b map[string]string = a // ERROR "cannot use"
	_ = b
}
