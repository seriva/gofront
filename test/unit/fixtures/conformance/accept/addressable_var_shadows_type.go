// compile-only
package main

type P struct{ X int }

func main() {
	P := 1
	P = 2
	p := &P
	_ = p
	{
		type Q int
		var Q int
		Q = 3
		_ = &Q
	}
}
