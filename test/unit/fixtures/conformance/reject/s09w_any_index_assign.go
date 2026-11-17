package main

func main() {
	var v any = map[string]int{}
	v["a"] = 1 // ERROR "cannot index v (variable of type any)"
}
