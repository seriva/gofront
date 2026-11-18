package main

func mk() [2]int { return [2]int{} }

func main() {
	mk()[0] = 1 // ERROR "cannot assign to mk()[0] (neither addressable nor a map index expression)"
}
