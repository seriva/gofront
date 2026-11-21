package main

func main() {
	_ = nil || true // ERROR "mismatched types untyped nil and untyped bool"
}
