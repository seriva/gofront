package main

func main() {
	c := complex(1, 2)
	_ = int(c) // ERROR "cannot convert c (variable of type complex128) to type int"
}
