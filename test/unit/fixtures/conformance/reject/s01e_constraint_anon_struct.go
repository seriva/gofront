package main

type Shape interface{ struct{ X int } }

func use[T Shape](v T) {}

func main() {
	use(struct{ Y string }{"a"}) // ERROR "does not satisfy"
}
