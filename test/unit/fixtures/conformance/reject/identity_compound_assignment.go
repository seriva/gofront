// pending: operator-message-text
package main

type A struct{ X int }

func main() {
	a := A{1}
	var u struct{ X int }
	u += a // ERROR "mismatched types struct{X int} and A"
	_ = u
}
