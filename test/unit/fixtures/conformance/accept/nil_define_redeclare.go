package main

import "fmt"

func main() {
	var p *int
	p, x := nil, 1
	fmt.Println(p == nil, x)
}

// Output:
// true 1
