// pending: S9
package main

func main() {
	var v any = 2
	v() // ERROR "cannot call non-function v (variable of type any)"
}
