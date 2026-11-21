package main

func main() {
	var v any = true
	_ = v && true // ERROR "mismatched types any and bool"
}
