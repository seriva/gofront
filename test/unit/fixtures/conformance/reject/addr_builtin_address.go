package main

func main() {
	_ = &len // ERROR "cannot take address of len"
}
