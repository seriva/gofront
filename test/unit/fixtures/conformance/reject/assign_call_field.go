package main

type P struct{ X int }

func mk() P { return P{} }

func main() {
	mk().X = 1 // ERROR "cannot assign to mk().X (neither addressable nor a map index expression)"
}
