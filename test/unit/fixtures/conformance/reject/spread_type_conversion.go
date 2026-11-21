package main

type S []int

func main() {
	_ = S([]int{1}...) // ERROR "invalid use of ... in conversion to S"
}
