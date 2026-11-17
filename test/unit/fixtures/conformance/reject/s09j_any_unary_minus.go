// pending: S9
package main

func main() {
	var v any = 2
	_ = -v // ERROR "operator - not defined on v (variable of type any)"
}
