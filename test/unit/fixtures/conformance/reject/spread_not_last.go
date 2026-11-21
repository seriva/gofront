package main

import "fmt"

func f(a int, b ...int) {}

func g(xs ...int) {}

func main() {
	f([]int{1}..., 2)           // ERROR "can only use ... with final argument in call to f"
	g([]int{1}..., []int{2}...) // ERROR "can only use ... with final argument in call to g"
	_ = append([]int{1}..., 2)  // ERROR "can only use ... with final argument in call to append"
	fmt.Println([]any{1}..., 2) // ERROR "can only use ... with final argument in call to fmt.Println"
}
