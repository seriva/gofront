package main

import "fmt"

func before() {
	var n int32 = 7
	type int32 = string
	var s int32 = "after"
	fmt.Println(n, s)
}

func other() {
	var n int32 = 9
	fmt.Println(n + 1)
}

func shadowAny() {
	type any = int
	var a any = 4
	fmt.Println(a + 1)
}

func plainAny() {
	var a any = "plain"
	fmt.Println(a)
}

func nested() {
	type string struct{ N int }
	s := string{N: 5}
	f := func() int { return s.N }
	fmt.Println(f())
}

func conv() {
	type float64 int
	x := float64(3)
	fmt.Println(x + 1)
}

func main() {
	before()
	other()
	shadowAny()
	plainAny()
	nested()
	conv()
	var s string = "still predeclared"
	var f float64 = 1.5
	var i int32 = 2
	fmt.Println(s, f, i)
}

// Output:
// 7 after
// 10
// 5
// plain
// 5
// 4
// still predeclared 1.5 2
