package main

type MyInt int

func F[T ~MyInt](a T) T { // ERROR "invalid use of ~ (underlying type of MyInt is int)"
	return -a
}

func main() {}
