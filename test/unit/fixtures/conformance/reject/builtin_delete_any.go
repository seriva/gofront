package main

func main() {
	var v any = map[int]int{1: 1}
	delete(v, 1) // ERROR "is not a map"
}
