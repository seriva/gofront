package main

func main() {
	_ = 'a' == "a"  // ERROR "mismatched types untyped rune and untyped string"
	_ = "a" == 1    // ERROR "mismatched types untyped string and untyped int"
	_ = true == 1   // ERROR "mismatched types untyped bool and untyped int"
	_ = true == 1i  // ERROR "mismatched types untyped bool and untyped complex"
	_ = "a" == 1i   // ERROR "mismatched types untyped string and untyped complex"
}
