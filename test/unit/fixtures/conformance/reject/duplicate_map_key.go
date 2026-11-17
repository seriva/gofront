package main

func main() {
	_ = map[string]int{
		"a": 1,
		"a": 2, // ERROR "duplicate key \"a\" in map literal"
	}
}
