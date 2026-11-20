package main

type F [2]func()
type S struct{ F F }

func main() {
	var m map[S]int // ERROR "invalid map key type S"
	_ = m
}
