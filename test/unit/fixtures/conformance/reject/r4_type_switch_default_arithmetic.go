// pending: S9
package main

func main() {
	var v any = 2
	switch x := v.(type) {
	case string:
		_ = x
	default:
		_ = x + 1 // ERROR "operator + not defined on x (variable of type any)"
	}
}
