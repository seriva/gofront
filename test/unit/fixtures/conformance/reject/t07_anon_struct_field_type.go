// pending: S1
package main

func main() {
	var a struct{ X int }
	var b struct{ X string }
	a = b // ERROR "Cannot assign"
	_ = a
}
