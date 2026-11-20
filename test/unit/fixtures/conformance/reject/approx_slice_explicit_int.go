package main

func F[S ~[]E, E any](s S) E {
	var z E
	return z
}

func main() {
	_ = F[int] // ERROR "S (type int) does not satisfy ~[]E"
}
