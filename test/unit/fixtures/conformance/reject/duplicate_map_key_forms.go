package main

const k = "a"

func main() {
	_ = map[int]int{1: 1, 0x1: 2}  // ERROR "duplicate key 1 in map literal"
	_ = map[float64]int{1: 1, 1.0: 2} // ERROR "duplicate key 1 in map literal"
	_ = map[string]int{"a": 1, k: 2} // ERROR "duplicate key \"a\" in map literal"
	_ = map[any]int{1: 1, 1: 2} // ERROR "duplicate key 1 in map literal"
	_ = map[bool]int{true: 1, true: 2} // ERROR "duplicate key true in map literal"
}
