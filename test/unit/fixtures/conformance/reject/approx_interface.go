package main

func F[T ~error](a T) {} // ERROR "invalid use of ~ (error is an interface)"

func main() {}
