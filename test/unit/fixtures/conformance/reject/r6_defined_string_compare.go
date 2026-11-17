// pending: S6
package main

type S string

func main() {
	var s S = "a"
	t := "a"
	_ = s == t // ERROR "mismatched types S and string"
}
