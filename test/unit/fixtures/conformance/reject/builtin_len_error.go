package main

func main() {
	var e error
	_ = len(e) // ERROR "for built-in len"
}
