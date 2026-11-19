// pending: assign-message-text
package main

type S[T any] struct{ X T }
type W[T any] S[T]

func main() {
	var w W[int]
	var s string = w.X // ERROR "cannot use"
	_ = s
}
