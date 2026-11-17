package main

import "fmt"

type Celsius float64

func main() {
	a := Celsius(1.5)
	b := Celsius(2)
	fmt.Println(a + b)
}

// Output:
// 3.5
