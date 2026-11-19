// pending: operand-text
package main

type P struct{ X int }

func main() {
	P{}.X = 1 // ERROR "cannot assign to P{}.X (neither addressable nor a map index expression)"
}
