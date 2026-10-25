package main

import (
	"container/heap"
	"fmt"
)

type IntHeap []int

func (h IntHeap) Len() int           { return len(h) }
func (h IntHeap) Less(i, j int) bool { return h[i] < h[j] }
func (h IntHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }

func (h *IntHeap) Push(x any) {
	*h = append(*h, x.(int))
}

func (h *IntHeap) Pop() any {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[0 : n-1]
	return x
}

func main() {
	h := &IntHeap{2, 1, 5, 3, 4}
	heap.Init(h)
	fmt.Println("init len:", h.Len())

	heap.Push(h, 0)
	fmt.Println("after push 0 min:", (*h)[0])

	popped := heap.Pop(h).(int)
	fmt.Println("pop:", popped)

	// Test Fix
	(*h)[0] = 10
	heap.Fix(h, 0)
	fmt.Println("after fix min:", (*h)[0])

	// Test Remove
	removed := heap.Remove(h, 1).(int)
	fmt.Println("removed at 1:", removed)

	// Pop all remaining
	fmt.Print("remaining:")
	for h.Len() > 0 {
		fmt.Printf(" %d", heap.Pop(h).(int))
	}
	fmt.Println()
}
