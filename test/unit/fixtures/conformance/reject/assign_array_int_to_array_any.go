package main

func main() {
	var a [2]int
	var b [2]any = a // ERROR "cannot use a (variable of type [2]int) as [2]any value in variable declaration"
	_ = b
}
