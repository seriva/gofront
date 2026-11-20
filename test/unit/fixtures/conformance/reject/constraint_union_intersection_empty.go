package main

func F[T interface {
	~int
	~string
}](a, b T) bool {
	return a < b // ERROR "type parameter T cannot use operator <"
}

func main() {}
