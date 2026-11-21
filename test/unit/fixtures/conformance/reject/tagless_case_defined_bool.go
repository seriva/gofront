package main

type MB bool

func main() {
	var b MB
	switch {
	case b: // ERROR "invalid case b in switch on true (mismatched types MB and bool)"
	}
}
