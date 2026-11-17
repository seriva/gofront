// pending: S5
package main

func main() {
	var c complex128 = 1
	var f float64 = 2
	_ = c + f // ERROR "mismatched types complex128 and float64"
}
