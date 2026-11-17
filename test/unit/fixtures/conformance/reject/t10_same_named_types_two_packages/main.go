package main

import (
	"./a"
	"./b"
)

func main() {
	var x a.P
	var y b.P = x // ERROR "Cannot assign"
	_ = y
}
