package main

import (
	"container/ring"
	"fmt"
)

func printRing(r *ring.Ring) {
	fmt.Print("ring [")
	r.Do(func(p any) {
		fmt.Printf(" %v", p)
	})
	fmt.Println(" ]")
}

func main() {
	r := ring.New(5)
	n := r.Len()
	for i := 0; i < n; i++ {
		r.Value = i
		r = r.Next()
	}

	fmt.Println("len:", r.Len())
	printRing(r)

	// Move forward and backward
	r = r.Move(3)
	fmt.Println("after move 3, current val:", r.Value)
	r = r.Move(-2)
	fmt.Println("after move -2, current val:", r.Value)

	// Link a second ring
	s := ring.New(3)
	for i := 0; i < s.Len(); i++ {
		s.Value = (i + 1) * 10
		s = s.Next()
	}
	fmt.Print("ring s: ")
	printRing(s)

	r.Link(s)
	fmt.Println("after link, len:", r.Len())
	printRing(r)

	// Unlink 3 elements
	unlinked := r.Unlink(3)
	fmt.Println("after unlink 3, r len:", r.Len())
	printRing(r)
	fmt.Println("unlinked len:", unlinked.Len())
	printRing(unlinked)
}
