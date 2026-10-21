package main

import (
	"cmp"
	"./lib"
)

type P cmp.Ordered

func main() { println(cmp.Compare(1, 2), lib.Run()) }
