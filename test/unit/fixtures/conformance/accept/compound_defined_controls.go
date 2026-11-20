package main

import "fmt"

type S string

func main() {
	var a S = "x"
	a += "y"
	var b, c S = "x", "y"
	var d S = b + c
	c2 := 5
	c2 %= 2
	n := 1
	n++
	fmt.Println(a, d, c2, n)
}

// Output:
// xy xy 1 2
