package main

import (
	"fmt"
	"iter"
	"slices"
	"strings"
)

type person struct {
	name string
	age  int
}

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

func chunkPanic() (msg string) {
	defer func() { msg = fmt.Sprintf("%v", recover()) }()
	slices.Chunk([]int{1, 2}, 0)
	return "no panic"
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

	// Sorted, SortedFunc, SortedStableFunc
	fmt.Println(slices.Sorted(slices.Values(words)))
	fmt.Println(slices.Sorted(countdown(5)))
	fmt.Println(slices.SortedFunc(slices.Values(words), func(a, b string) int {
		return len(a) - len(b)
	}))
	people := []person{{"dan", 30}, {"ann", 25}, {"bob", 30}, {"cat", 25}}
	byAge := slices.SortedStableFunc(slices.Values(people), func(a, b person) int {
		return a.age - b.age
	})
	for _, p := range byAge {
		fmt.Println("stable", p.name, p.age)
	}

	// Chunk
	for c := range slices.Chunk([]int{1, 2, 3, 4, 5, 6, 7}, 3) {
		fmt.Println("chunk", c, len(c), cap(c))
	}
	n := 0
	for range slices.Chunk([]int{}, 2) {
		n++
	}
	fmt.Println("empty chunks", n)
	fmt.Println("chunk panic:", chunkPanic())
}
