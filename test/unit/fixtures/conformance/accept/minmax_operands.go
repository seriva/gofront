package main

import "fmt"

type Celsius float64

func main() {
	var f float64 = 1
	var a int = 3
	c := Celsius(4)
	fmt.Println(max(1, 2.5), min(f, 2), min(2, a, 5), max(c, 2), min("b", "a"), max(1, 2, 3.5))
}

// Output:
// 2.5 1 2 4 a 3.5
