package main

func C1[T ~*[]int](p T) int {
	return cap(p) // ERROR "invalid argument: p (variable of type T constrained by ~*[]int) for"
}

func L1[T ~*[]int](p T) int {
	return len(p) // ERROR "invalid argument: p (variable of type T constrained by ~*[]int) for built-in len"
}

func L2[T ~*map[int]int](p T) int {
	return len(p) // ERROR "invalid argument: p (variable of type T constrained by ~*map[int]int) for built-in len"
}

func main() {}
