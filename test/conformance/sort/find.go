package main

import (
	"fmt"
	"sort"
	"strings"
)

func main() {
	a := []int{1, 3, 5, 7, 9}
	for _, x := range []int{0, 1, 4, 5, 9, 10} {
		i, found := sort.Find(len(a), func(i int) int { return x - a[i] })
		fmt.Println(x, i, found)
	}
	i, found := sort.Find(0, func(i int) int { panic("not called") })
	fmt.Println(i, found)

	words := []string{"apple", "banana", "cherry"}
	i, found = sort.Find(len(words), func(i int) int { return strings.Compare("banana", words[i]) })
	fmt.Println(i, found)
	i, found = sort.Find(len(words), func(i int) int { return strings.Compare("blueberry", words[i]) })
	fmt.Println(i, found)

	calls := 0
	i, found = sort.Find(1000, func(i int) int {
		calls++
		return 637 - i
	})
	fmt.Println(i, found, calls)
}
