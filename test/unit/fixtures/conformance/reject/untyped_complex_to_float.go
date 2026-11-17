package main

func main() {
	var f float64 = 1
	_ = f + 1i // ERROR "overflows float64"
}
