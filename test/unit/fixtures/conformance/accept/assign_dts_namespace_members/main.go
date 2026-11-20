// compile-only
// targets: js
package main

import "js:lib.d.ts"

func main() {
	NS.count = 3
	NS.hook = func() {}
}
