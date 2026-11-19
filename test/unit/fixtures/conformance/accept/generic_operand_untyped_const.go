package main

import "fmt"

func Add1[T ~int | ~float64](a T) T { return a + 1 }

func Twice[T ~int | ~float64](a T) T { return 2.0 * a }

func Big[T ~int8 | ~int](a T) bool { return a < 127 }

func Not[T ~bool](a, b T) T { return a && true || b }

func Cat[T ~string](a T) T { return a + "!" }

func IsNil[T ~[]int](a T) bool { return a == nil }

func main() {
	fmt.Println(Add1(1), Add1(1.5), Twice(3), Big(int8(5)), Not(false, true), Cat("hi"), IsNil([]int(nil)))
}

// Output:
// 2 2.5 6 true true hi! true
