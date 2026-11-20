// compile-only
package main

import . "./dot"

func main() {
	type Q struct{ X int }
	q := Q{X: 3}
	_ = q.X
	{
		type Q string
		var s Q = "a"
		_ = s
	}
	_ = Q{}
}
