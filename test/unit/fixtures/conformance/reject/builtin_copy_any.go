package main

func main() {
	var v any = []int{1}
	copy(v, []int{2}) // ERROR "invalid copy: argument must be a slice"
}
