package main

type T struct{}

func (t **T) M() {} // ERROR "invalid receiver type **T"

func main() {}
