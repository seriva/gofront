package main

func main() {
	b := true
	_ = -b // ERROR "operator - not defined on b (variable of type bool)"
	s := "a"
	_ = +s // ERROR "operator + not defined on s (variable of type string)"
}
