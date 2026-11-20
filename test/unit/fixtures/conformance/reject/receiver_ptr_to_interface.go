package main

type I interface{ M() }

func (p *I) N() {} // ERROR "invalid receiver type I (pointer or interface type)"

func main() {}
