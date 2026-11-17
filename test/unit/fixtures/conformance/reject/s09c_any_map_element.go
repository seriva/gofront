// pending: S9
package main

func main() {
	m := map[string]any{"a": 2}
	_ = m["a"] * 2 // ERROR "operator * not defined on"
}
