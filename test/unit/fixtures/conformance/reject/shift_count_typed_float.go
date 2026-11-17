package main

func main() {
	x := 1
	const f float64 = 1.0
	_ = x << f             // ERROR "invalid shift count"
	_ = x << float64(1.0)  // ERROR "invalid shift count"
}
