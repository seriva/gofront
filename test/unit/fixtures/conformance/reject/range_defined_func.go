package main

type MyFunc func(int)

func main() {
	var fn MyFunc
	for range fn { // ERROR "cannot range over func"
	}
}
