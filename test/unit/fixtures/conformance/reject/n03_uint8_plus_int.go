// pending: S5
package main

func main() {
	var a uint8 = 1
	b := 2
	_ = a + b // ERROR "mismatched types uint8 and int"
}
