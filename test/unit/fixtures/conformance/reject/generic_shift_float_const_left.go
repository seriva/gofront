package main

func F[T ~uint](s T) int {
	return 1.5 << s // ERROR "invalid operation: shifted operand 1.5 (untyped float constant) must be integer"
}

func G(s uint) int {
	return 2.5 >> s // ERROR "invalid operation: shifted operand 2.5 (untyped float constant) must be integer"
}

func main() {}
