// compile-only
// targets: js
package main

func main() {
	x := window.something
	x()
	_ = x[0]
	x["a"] = 1
	_ = x[1:]
	for range x {
	}
	for _, e := range x {
		_ = e
	}
	if x {
	}
	for x {
		break
	}
	x++
	x += 2
	_ = -x
	_ = !x
	_ = *x
}
