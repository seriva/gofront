// pending: S9
package main

func main() {
	var v any = []int{1}
	_ = v[0] // ERROR "cannot index v (variable of type any)"
}
