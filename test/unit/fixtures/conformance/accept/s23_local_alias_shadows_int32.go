package main

import "fmt"

func main() {
	type int32 = string
	var s int32 = "aliased"
	fmt.Println(s)
}

// Output:
// aliased
