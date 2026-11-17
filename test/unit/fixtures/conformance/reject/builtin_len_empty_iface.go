package main

func main() {
	var v interface{} = []int{1}
	_ = len(v) // ERROR "for built-in len"
}
