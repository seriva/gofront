package main

import (
	"fmt"
	"math"
	"sort"
)

type item struct {
	key int
	val string
}

type byKey []item

func (b byKey) Len() int           { return len(b) }
func (b byKey) Less(i, j int) bool { return b[i].key < b[j].key }
func (b byKey) Swap(i, j int)      { b[i], b[j] = b[j], b[i] }

func main() {
	// 1. pdqsort with duplicate keys
	items := byKey{
		{key: 3, val: "a"},
		{key: 1, val: "b"},
		{key: 2, val: "c"},
		{key: 2, val: "d"},
		{key: 1, val: "e"},
		{key: 3, val: "f"},
		{key: 2, val: "g"},
		{key: 0, val: "h"},
		{key: 5, val: "i"},
		{key: 4, val: "j"},
		{key: 2, val: "k"},
		{key: 1, val: "l"},
		{key: 3, val: "m"},
		{key: 0, val: "n"},
	}
	sort.Sort(items)
	fmt.Print("pdqsort:")
	for _, it := range items {
		fmt.Printf(" %d:%s", it.key, it.val)
	}
	fmt.Println()
	fmt.Println("IsSorted:", sort.IsSorted(items))

	// 2. Stable sort
	items2 := byKey{
		{key: 3, val: "a"},
		{key: 1, val: "b"},
		{key: 2, val: "c"},
		{key: 2, val: "d"},
		{key: 1, val: "e"},
		{key: 3, val: "f"},
		{key: 2, val: "g"},
		{key: 0, val: "h"},
	}
	sort.Stable(items2)
	fmt.Print("stable:")
	for _, it := range items2 {
		fmt.Printf(" %d:%s", it.key, it.val)
	}
	fmt.Println()

	// 3. Reverse
	sort.Sort(sort.Reverse(items2))
	fmt.Print("reverse:")
	for _, it := range items2 {
		fmt.Printf(" %d:%s", it.key, it.val)
	}
	fmt.Println()
	fmt.Println("IsSorted reverse:", sort.IsSorted(sort.Reverse(items2)))

	// 4. IntSlice, StringSlice, Float64Slice
	ints := sort.IntSlice{5, 2, 6, 3, 1, 4}
	ints.Sort()
	fmt.Println("IntSlice:", ints)

	strings := sort.StringSlice{"banana", "apple", "cherry", "date"}
	strings.Sort()
	fmt.Println("StringSlice:", strings)

	floats := sort.Float64Slice{3.14, 1.41, math.NaN(), 2.71, math.NaN(), 0.58}
	floats.Sort()
	fmt.Print("Float64Slice:")
	for _, f := range floats {
		if math.IsNaN(f) {
			fmt.Print(" NaN")
		} else {
			fmt.Printf(" %.2f", f)
		}
	}
	fmt.Println()

	// 5. SearchInts, SearchStrings, SearchFloat64s
	sortedInts := []int{10, 20, 30, 40, 50}
	fmt.Println("SearchInts 30:", sort.SearchInts(sortedInts, 30))
	fmt.Println("SearchInts 25:", sort.SearchInts(sortedInts, 25))
	fmt.Println("SearchInts 5:", sort.SearchInts(sortedInts, 5))
	fmt.Println("SearchInts 60:", sort.SearchInts(sortedInts, 60))

	sortedStrings := []string{"apple", "banana", "cherry", "date"}
	fmt.Println("SearchStrings banana:", sort.SearchStrings(sortedStrings, "banana"))
	fmt.Println("SearchStrings blueberry:", sort.SearchStrings(sortedStrings, "blueberry"))

	sortedFloats := []float64{1.1, 2.2, 3.3, 4.4}
	fmt.Println("SearchFloat64s 3.3:", sort.SearchFloat64s(sortedFloats, 3.3))
	fmt.Println("SearchFloat64s 0.5:", sort.SearchFloat64s(sortedFloats, 0.5))
}
