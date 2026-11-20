package main

func main() {
	var n int
	n, x := nil, 1 // ERROR "cannot use nil as int value in assignment"
	println(n, x)
}
