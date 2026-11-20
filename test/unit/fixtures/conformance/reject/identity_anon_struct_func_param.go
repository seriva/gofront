package main

func g(s struct{ Y string }) {}

func main() {
	var f func(struct{ X int }) = g // ERROR "cannot use"
	_ = f
}
