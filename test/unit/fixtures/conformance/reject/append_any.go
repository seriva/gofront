package main

func main() {
	var v any = []int{1}
	_ = append(v, 1) // ERROR "invalid append: argument must be a slice"
}
