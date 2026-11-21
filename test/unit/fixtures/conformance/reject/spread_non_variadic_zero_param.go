package main

func h() {}

func main() {
	h([]int{1}...) // ERROR "cannot use ... in call to non-variadic h"
}
