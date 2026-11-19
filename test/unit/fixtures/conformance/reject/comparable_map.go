package main

func c[C comparable](x C) {}

func main() {
	c(map[int]int{}) // ERROR "map[int]int does not satisfy comparable"
}
