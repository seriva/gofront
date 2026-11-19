package main

func F[T ~uint](s T) int {
	return "a" << s // ERROR "invalid operation: shifted operand \"a\" (untyped string constant) must be integer"
}

func G[T ~uint](s T) bool {
	return true << s // ERROR "invalid operation: shifted operand true (untyped bool constant) must be integer"
}

func main() {}
