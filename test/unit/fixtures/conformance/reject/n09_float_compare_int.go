package main

func main() {
	f := 1.5
	i := 2
	_ = f == i // ERROR "mismatched types float64 and int"
	_ = f < i  // ERROR "mismatched types float64 and int"
}
