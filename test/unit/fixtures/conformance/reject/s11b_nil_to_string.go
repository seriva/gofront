// pending: S11
package main

func main() {
	var s string = nil // ERROR "cannot use nil as string value in variable declaration"
	_ = s
}
