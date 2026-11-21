package main

type A = []int

func (a A) M() {} // ERROR "invalid receiver type A"

func main() {}
