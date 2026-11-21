// targets: js, both
package main

import "fmt"

type A struct{ X int }

func main() {
	a := A{5}
	switch a {
	case struct{ X int }{5}:
		fmt.Println("matched")
	}
}

// Output:
// matched
