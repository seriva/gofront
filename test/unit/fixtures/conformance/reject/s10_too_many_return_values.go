// pending: S10
package main

func f() int {
	return 1, 2 // ERROR "too many return values"
}

func main() { _ = f() }
