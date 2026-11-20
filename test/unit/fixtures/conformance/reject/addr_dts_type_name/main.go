// targets: js
package main

import "js:lib.d.ts"

func main() {
	Widget = nil // ERROR "cannot assign to Widget"
	_ = &Widget  // ERROR "cannot take address of Widget"
}
