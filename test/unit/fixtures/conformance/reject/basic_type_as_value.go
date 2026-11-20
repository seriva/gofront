package main

import "fmt"

func main() {
	fmt.Println(int) // ERROR "int (type) is not an expression"
	_ = int + 1 // ERROR "int (type) is not an expression"
}
