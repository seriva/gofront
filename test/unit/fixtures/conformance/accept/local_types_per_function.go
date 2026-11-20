package main

import "fmt"

type R int

func a() {
	type Q struct{ X int }
	fmt.Println(Q{1})
}

func b() {
	type Q struct{ Y string }
	fmt.Println(Q{"b"})
	type R string
	var r R = "s"
	fmt.Println(r)
}

func main() {
	a()
	b()
	var r R = 7
	fmt.Println(r)
	{
		type Q float64
		fmt.Println(Q(2.5))
	}
	{
		type Q bool
		fmt.Println(Q(true))
	}
}

// Output:
// {1}
// {b}
// s
// 7
// 2.5
// true
