package main

type MyAny any

func main() {
	var v MyAny
	for v { // ERROR "non-boolean condition in for statement"
	}
}
