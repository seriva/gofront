package main

func main() {
	copy(1, []int{1})      // ERROR "invalid copy"
	copy("a", "b")         // ERROR "invalid copy"
	copy([]int{1}, 5)      // ERROR "invalid copy"
}
