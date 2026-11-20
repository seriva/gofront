package main

type P struct{ X int }

func mk() P { return P{} }

func main() {
	var y int
	mk().X, y = 1, 2 // ERROR "cannot assign to mk().X (neither addressable nor a map index expression)"
	_ = y
}
