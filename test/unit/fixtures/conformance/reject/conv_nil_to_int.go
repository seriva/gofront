package main

func main() {
	_ = int(nil) // ERROR "cannot convert nil to type int"
}
