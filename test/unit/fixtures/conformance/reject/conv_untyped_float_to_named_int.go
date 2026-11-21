package main

type MI int

func main() {
	_ = MI(1.5) // ERROR "cannot convert 1.5 (untyped float constant) to type MI (truncated)"
	_ = int(1.5) // ERROR "cannot convert 1.5 (untyped float constant) to type int (truncated)"
}
