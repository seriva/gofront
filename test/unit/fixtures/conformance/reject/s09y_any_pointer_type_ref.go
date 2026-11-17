package main

func main() {
	p := (*any)(nil)
	_ = *p + 1 // ERROR "operator + not defined on *p"
}
