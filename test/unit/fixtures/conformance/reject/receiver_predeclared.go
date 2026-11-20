package main

func (i int) M() {} // ERROR "cannot define new methods on non-local type int"

func main() {}
