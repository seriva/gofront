package main

import (
	"./a"
	"./b"
)

func main() {
	var x a.P
	var y b.P = x // ERROR ") as b.P value in variable declaration"
	_ = y
}
