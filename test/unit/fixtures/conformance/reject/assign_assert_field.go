// pending: operand-text
package main

type P struct{ X int }

func main() {
	var i any = P{}
	i.(P).X = 1 // ERROR "cannot assign to i.(P).X (neither addressable nor a map index expression)"
}
