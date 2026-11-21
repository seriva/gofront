package main

func f[T any](x T) {
	switch x { // ERROR "cannot switch on x (variable of type T constrained by any) (T is not comparable)"
	case x:
	}
}

func main() { f(1) }
