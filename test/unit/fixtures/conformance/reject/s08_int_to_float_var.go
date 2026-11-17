// pending: S8
package main

func main() {
	i := 3
	var f float64 = i // ERROR "cannot use i (variable of type int) as float64 value in variable declaration"
	_ = f
}
