// pending: S20
package main

type I interface{ M() }
type S struct{}

func main() {
	var i I
	switch i.(type) {
	case S: // ERROR "impossible type switch case"
	}
}
