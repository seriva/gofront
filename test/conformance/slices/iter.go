package main

import (
	"fmt"
	"iter"
	"slices"
	"strings"
)

// countdown yields n, n-1, ..., 1.
func countdown(n int) iter.Seq[int] {
	return func(yield func(int) bool) {
		for i := n; i > 0; i-- {
			if !yield(i) {
				return
			}
		}
	}
}

func main() {
	words := []string{"pear", "apple", "fig"}

	// All, Values, Backward
	for i, w := range slices.All(words) {
		fmt.Println("all", i, w)
	}
	for w := range slices.Values(words) {
		fmt.Println("value", w)
	}
	for i, w := range slices.Backward(words) {
		fmt.Println("backward", i, w)
	}
	for i, w := range slices.All(words) {
		if i == 1 {
			break
		}
		fmt.Println("first", w)
	}

	// Collect, AppendSeq
	fmt.Println(slices.Collect(countdown(4)))
	fmt.Println(slices.AppendSeq([]int{10, 20}, countdown(2)))
	fmt.Println(len(slices.Collect(countdown(0))))
	up := slices.Collect(slices.Values(words))
	up[0] = strings.ToUpper(up[0])
	fmt.Println(words, up)
}
