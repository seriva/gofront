package main

import "fmt"

type A struct{ X int }

func main() {
	a := A{5}
	switch a {
	case struct{ X int }{5}: // ERROR "mismatched"
		fmt.Println("matched")
	}
}
