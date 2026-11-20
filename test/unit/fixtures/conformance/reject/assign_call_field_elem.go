package main

type P struct{ A [2]int }

func mk() P { return P{} }

func main() {
	mk().A[0] = 1 // ERROR "cannot assign to mk().A[0] (neither addressable nor a map index expression)"
}
