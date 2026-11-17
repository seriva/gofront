package main

func f[T any]() T {
	var x T = nil // ERROR "cannot use nil as T value in variable declaration"
	return x
}

func main() {
	_ = f[int]()
}
