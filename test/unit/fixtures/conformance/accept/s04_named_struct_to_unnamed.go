// pending: S4
package main

import "fmt"

type A struct{ X int }

func main() {
	a := A{1}
	var c struct{ X int } = a
	fmt.Println(c.X)
}

// Output:
// 1
