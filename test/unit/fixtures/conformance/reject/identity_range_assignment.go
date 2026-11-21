package main

type A struct{ X int }

func main() {
	xs := []A{{1}, {2}}
	var u struct{ X int }
	for _, u = range xs { // ERROR "Cannot assign A to struct{X int} here"
		_ = u
	}
}
