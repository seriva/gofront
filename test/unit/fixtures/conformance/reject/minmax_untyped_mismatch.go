package main

func main() {
	_ = min(1, "a") // ERROR "mismatched types untyped int (previous argument) and untyped string (type of \"a\")"
}
