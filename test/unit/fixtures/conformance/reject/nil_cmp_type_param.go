package main

func a[T any](x T) bool        { return x == nil } // ERROR "mismatched types T and untyped nil"
func b[T comparable](x T) bool { return x == nil } // ERROR "mismatched types T and untyped nil"
func c[T ~int](x T) bool       { return x == nil } // ERROR "mismatched types T and untyped nil"

func main() {
	_ = a(1)
	_ = b(1)
	_ = c(1)
}
