package main

func main() {
	_ = append([]int{}, 1, []int{2}...) // ERROR "too many arguments in call to append"
	_ = append([]int{}...)              // ERROR "not enough arguments in call to append"
}
