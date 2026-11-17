package main

func main() {
	s := "a"
	_ = s == 'a' // ERROR "mismatched types string and untyped rune"
}
