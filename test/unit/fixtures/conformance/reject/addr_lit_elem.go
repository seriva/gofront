// pending: operand-text
package main

func main() {
	_ = &[2]int{1, 2}[0] // ERROR "cannot take address of [2]int{…}[0]"
}
