// targets: js
package main

import "js:lib.d.ts"

func main() {
	NS.Inner = nil // ERROR "cannot assign to NS.Inner"
	_ = &NS.Inner  // ERROR "cannot take address of NS.Inner"
	NS.Shape = nil // ERROR "cannot assign to NS.Shape"
	NS.Deep = nil  // ERROR "cannot assign to NS.Deep"
}
