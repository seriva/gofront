// pending: S1
package main

func g(s struct{ Y string }) {}

func main() {
	var f func(struct{ X int }) = g // ERROR "Cannot assign"
	_ = f
}
