package main

func f[T comparable](x T) {
	switch x {
	case nil: // ERROR "cannot convert nil to type T"
	}
}

func main() { f(1) }
