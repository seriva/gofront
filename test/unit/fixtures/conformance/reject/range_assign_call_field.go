package main

type P struct{ X int }

func mk() P { return P{} }

func main() {
	for mk().X = range []int{1} { // ERROR "cannot assign to mk().X (neither addressable nor a map index expression)"
	}
}
