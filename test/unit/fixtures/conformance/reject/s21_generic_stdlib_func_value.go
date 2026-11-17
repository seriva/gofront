// pending: S21
package main

import (
	"fmt"
	"slices"
)

func main() {
	fmt.Println(slices.Reverse) // ERROR "cannot use generic function slices.Reverse without instantiation"
}
