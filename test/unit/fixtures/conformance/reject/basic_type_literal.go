package main

func f[T any]() {
	_ = T{} // ERROR "invalid composite literal type T"
}

func main() {
	_ = int{} // ERROR "invalid composite literal type int"
	f[int]()
}
