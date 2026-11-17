package main

import (
	"fmt"
	"slices"
)

func seq(yield func(int) bool) {
	for i := 0; i < 4; i++ {
		if !yield(i) {
			return
		}
	}
}

func nested() {
outer:
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			if j == 1 {
				continue outer
			}
			if i == 2 {
				break outer
			}
			fmt.Printf("%d%d;", i, j)
		}
	}
	fmt.Println()
}

func switchLabel() {
sw:
	switch 1 {
	case 1:
		for {
			break sw
		}
	}
}

func rangeFunc() {
rng:
	for i := range 3 {
		for v := range seq {
			if v == 2 {
				continue rng
			}
			if i == 2 {
				break rng
			}
			fmt.Printf("%d%d;", i, v)
		}
	}
	fmt.Println()
}

func rangeSlice() {
loop:
	for _, x := range []int{1, 2, 3} {
		switch x {
		case 2:
			continue loop
		case 3:
			break loop
		}
		fmt.Printf("%d;", x)
	}
	fmt.Println()
}

func main() {
	nested()
	switchLabel()
	rangeFunc()
	rangeSlice()
	func() {
	inner:
		for {
			break inner
		}
	}()
	// The same label name in two functions and in sibling statements.
a:
	for range 1 {
		break a
	}
a2:
	for range 1 {
		break a2
	}
	fmt.Println(slices.Max([]int{1, 2}))
}

// Output:
// 00;10;
// 00;01;10;11;
// 1;
// 2
