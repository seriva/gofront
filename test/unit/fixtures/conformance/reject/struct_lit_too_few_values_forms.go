package main

type S struct {
	A int
	B string
}

type E struct {
	S
	C int
}

func main() {
	_ = E{S{1, "a"}} // ERROR "too few values in struct literal of type E"
	_ = []S{{1}}      // ERROR "too few values in struct literal of type S"
	_ = &S{1}         // ERROR "too few values in struct literal of type S"
}
