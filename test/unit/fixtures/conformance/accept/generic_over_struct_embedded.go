package main

import (
	"encoding/json"
	"fmt"
)

type S[T any] struct{ X T }
type W[T any] S[T]

type Outer struct {
	W[int]
}

func main() {
	var o Outer
	fmt.Println(o.X)
	b, _ := json.Marshal(Outer{W: W[int]{X: 5}})
	fmt.Println(string(b))
}

// Output:
// 0
// {"X":5}
