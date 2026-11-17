package main

func main() {
	var v any = []int{1}
	_ = len(v) // ERROR "invalid argument: v (variable of type any) for built-in len"
}
