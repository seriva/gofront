package main

import "fmt"

func main() {
	var b byte = 1
	var u uint8 = b
	var r rune = 'a'
	var i int32 = r
	fmt.Println(u, i)
}

// Output:
// 1 97
