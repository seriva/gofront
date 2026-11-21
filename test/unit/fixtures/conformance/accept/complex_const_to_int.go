package main

import "fmt"

func main() {
	var i int = 1 + 0i
	var u uint8 = complex(2, 0)
	fmt.Println(i, u)
}

// Output:
// 1 2
