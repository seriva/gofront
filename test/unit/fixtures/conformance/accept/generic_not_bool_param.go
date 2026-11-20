package main

import "fmt"

type B bool

func Not[T ~bool](a T) T { return !a }

func NotNot[T ~bool](a T) T {
	b := !a
	return !b
}

func main() {
	fmt.Println(Not(true), Not(B(false)), NotNot(true))
	fmt.Printf("%T\n", Not(B(true)))
}

// Output:
// false true true
// main.B
