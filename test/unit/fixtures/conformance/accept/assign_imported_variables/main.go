// compile-only
package main

import (
	"./sub"

	. "./dot"
)

func main() {
	sub.V = 2
	sub.V++
	sub.V += 3
	sub.Handler = func() {}
	W = sub.V
	W++
	Hook = sub.Handler
}
