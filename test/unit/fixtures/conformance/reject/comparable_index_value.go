package main

import "slices"

func main() {
	_ = slices.Index[[]func()] // ERROR "does not satisfy comparable"
}
