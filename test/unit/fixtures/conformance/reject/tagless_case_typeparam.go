package main

func f[T any](x T) {
	switch {
	case x: // ERROR "invalid case x in switch on true (mismatched types T and bool)"
	}
}

func main() { f(1) }
