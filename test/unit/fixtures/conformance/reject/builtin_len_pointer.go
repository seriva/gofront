package main

func main() {
	p := new(int)
	_ = len(p) // ERROR "for built-in len"
}
