// compile-only
// targets: js
package main

import "js:lib.d.ts"

func main() {
	x := getAny()
	y := x * 2
	_ = y
}
