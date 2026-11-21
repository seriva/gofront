package main

func main() {
	var s []int
	s = append(s, "a") // ERROR "cannot use \"a\" (untyped string constant) as int value in argument to append"
	_ = s
}
