package main

func main() {
	var v any = []int{1}
	clear(v) // ERROR "cannot clear v"
}
