// compile-only
// targets: js
package main

func main() {
	len := 1
	len = 2
	p := &len
	_ = p
}
