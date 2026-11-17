// pending: S7
package main

func main() {
	a := 5.5
	b := 2.0
	_ = a % b // ERROR "operator % not defined on a (variable of type float64)"
}
