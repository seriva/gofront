// pending: S9
package main

func main() {
	xs := []any{1, 2}
	for _, x := range xs {
		_ = x * 2 // ERROR "operator * not defined on x (variable of type any)"
	}
}
