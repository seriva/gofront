// targets: js, both
package main

import "fmt"

type A struct{ X int }

func main() {
	s := append([]struct{ X int }{}, A{5})
	b := append([]byte("a"), "bc"...)
	fmt.Println(s[0].X, string(b))
}

// Output:
// 5 abc
