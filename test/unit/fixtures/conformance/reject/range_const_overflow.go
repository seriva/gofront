package main

func main() {
	for i := range 1 << 63 { // ERROR "(untyped int constant 9223372036854775808) as int value in range clause (overflows)"
		_ = i
	}
	for range 1 << 63 { // ERROR "as int value in range clause (overflows)"
	}
}
