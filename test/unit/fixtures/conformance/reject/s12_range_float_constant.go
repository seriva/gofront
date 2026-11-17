// pending: S12
package main

func main() {
	for i := range 1.5 { // ERROR "cannot range over 1.5 (untyped float constant)"
		_ = i
	}
}
