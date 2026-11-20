package main

func G[T ~uint](s T) {
	_ = 1i << s // ERROR "shifted operand 1i (untyped complex constant (0 + 1i)) must be integer"
}

func main() {
	G(uint(1))
}
