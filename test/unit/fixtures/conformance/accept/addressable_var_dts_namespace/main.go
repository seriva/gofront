// compile-only
// targets: js
package main

import "js:lib.d.ts"

func main() {
	var Widget Widget
	Widget.label = "hi"
	p := &Widget
	_ = p
}
