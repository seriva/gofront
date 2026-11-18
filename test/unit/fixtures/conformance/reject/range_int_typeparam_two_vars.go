package main

func f[T ~int](x T) {
	for i, v := range x { // ERROR "range over x (variable of type T) permits only one iteration variable"
		_, _ = i, v
	}
}

func main() {
	f(3)
}
