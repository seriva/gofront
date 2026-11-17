package main

func main() {
	var dst []struct{ X int }
	var src []struct{ Y string }
	copy(dst, src) // ERROR "arguments to copy dst and src have different element types"
}
