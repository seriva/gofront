package main

func main() {
	x := 1
	_ = x << 1e20 // ERROR "overflows uint"
}
