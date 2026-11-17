// pending: S23
package main

import "fmt"

func main() {
	type float64 struct{ X int }
	f := float64{X: 3}
	fmt.Println(f.X)
}

// Output:
// 3
