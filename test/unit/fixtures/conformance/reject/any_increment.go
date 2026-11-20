package main

func main() {
	var v any = 2
	v++ // ERROR "v++ (non-numeric type any)"
}
