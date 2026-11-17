// pending: S12
package main

func main() {
	b := true
	for range b { // ERROR "cannot range over b (variable of type bool)"
	}
}
