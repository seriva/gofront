package main

func main() {
	var c complex128 = 1i
	k := uint(1)
	c += 1 << k // ERROR "shifted operand 1 (type complex128) must be integer"
}
