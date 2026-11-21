package main

type MyInt int

func main() {
	var s []int
	_ = []MyInt(s) // ERROR "cannot convert s (variable of type []int) to type []MyInt"
	var m map[string]int
	_ = map[string]MyInt(m) // ERROR "cannot convert m (variable of type map[string]int) to type map[string]MyInt"
	var a [2]int
	_ = [2]MyInt(a) // ERROR "cannot convert a (variable of type [2]int) to type [2]MyInt"
}
