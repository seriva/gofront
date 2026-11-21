package main

func main() {
	var a, b [2][]int
	println(a == b) // ERROR "[2][]int cannot be compared"
}
