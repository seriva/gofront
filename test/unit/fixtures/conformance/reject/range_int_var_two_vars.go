package main

func main() {
	n := 3
	for i, v := range n { // ERROR "range over n (variable of type int) permits only one iteration variable"
		_, _ = i, v
	}
}
