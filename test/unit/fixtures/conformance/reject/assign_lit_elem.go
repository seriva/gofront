// pending: operand-text
package main

func main() {
	[2]int{1, 2}[0] = 3 // ERROR "cannot assign to [2]int{…}[0] (neither addressable nor a map index expression)"
}
