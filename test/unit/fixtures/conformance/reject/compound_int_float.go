package main

func main() {
	i := 1
	f := 2.0
	i += f // ERROR "invalid operation: i += f (mismatched types int and float64)"
}
