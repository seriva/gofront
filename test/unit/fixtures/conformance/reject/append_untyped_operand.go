package main

func main() {
	_ = append("a", 98) // ERROR "invalid append"
	_ = append(1, 2)    // ERROR "invalid append"
}
