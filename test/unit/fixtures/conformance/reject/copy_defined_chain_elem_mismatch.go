package main

type S1 []int
type S2 S1

func main() {
	copy(S2{1}, []string{"a"}) // ERROR "have different element types"
}
