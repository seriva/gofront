package main

func f[K any]() {
	var m map[K]int // ERROR "invalid map key type K (missing comparable constraint)"
	_ = m
}

func main() {}
