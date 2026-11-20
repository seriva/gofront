package main

type MyAny any

func main() {
	var v MyAny
	if v { // ERROR "non-boolean condition in if statement"
	}
}
