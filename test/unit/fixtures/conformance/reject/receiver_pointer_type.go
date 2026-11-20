package main

type P *int

func (p P) M() {} // ERROR "invalid receiver type P (pointer or interface type)"

func main() {}
