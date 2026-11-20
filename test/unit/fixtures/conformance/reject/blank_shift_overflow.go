package main

func main() {
	_ = 1 << 'a' // ERROR "(untyped int constant 158456325028528675187087900672) as int value in assignment to _ identifier (overflows)"
}
