package main

func main() {
	var v any = true
	for v { // ERROR "non-boolean condition in for statement"
	}
}
