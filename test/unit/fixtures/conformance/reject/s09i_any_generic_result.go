// pending: S9
package main

func first[T any](xs []T) T { return xs[0] }

func main() {
	_ = first([]any{1}) * 2 // ERROR "operator * not defined on"
}
