// pending: S9
package main

func main() {
	var v any = true
	if v { // ERROR "non-boolean condition in if statement"
	}
}
