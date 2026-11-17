package main

func Id[T any](x T) T { return x }

func main() {
	f := Id // ERROR "cannot use generic function Id without instantiation"
	_ = f
}
