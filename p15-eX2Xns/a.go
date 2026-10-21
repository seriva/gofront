package main

import "cmp"

func Min(a, b int) int { if cmp.Less(a, b) { return a }; return b }

func main() { println(Min(1, 2)) }
