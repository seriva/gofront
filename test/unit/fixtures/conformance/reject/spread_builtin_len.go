package main

func main() {
	_ = len([]int{1}...)  // ERROR "invalid use of ... with built-in len"
	_ = min([]int{1}...)  // ERROR "invalid use of ... with built-in min"
	_ = make([]int{1}...) // ERROR "invalid use of ... with built-in make"
}
