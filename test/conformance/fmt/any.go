package main

import (
	"errors"
	"fmt"
)

type P struct{ A int }

type Color int

func (c Color) String() string { return "color" }

type Named string

func show(v any) {
	fmt.Println(v)
	fmt.Println(fmt.Sprint(v))
	fmt.Printf("%v\n", v)
}

func main() {
	show(5)
	show("hi")
	show(2.5)
	show(true)
	show(int8(-3))
	show(uint64(1 << 40))
	show(float32(1.5))
	show('x')
	show([]int{1, 2})
	show(P{3})
	show(&P{4})
	show([]string{"a", "b"})
	show(map[string]int{"a": 1})
	show(errors.New("boom"))
	show(Color(1))
	show(Named("n"))
	show([]P{{1}, {2}})
	show([]any{1, "a", nil})
	var n any
	show(n)
	fmt.Println("a", n, 3)

	var a any = 7
	fmt.Printf("%d|%v|%5d|%x\n", a, a, a, a)
	var c any = Color(1)
	fmt.Printf("%d|%v|%s\n", c, c, c)

	fmt.Println(fmt.Sprintf("%v", nil))
	fmt.Println(fmt.Sprint(nil), fmt.Sprintln(nil) == "<nil>\n")
	fmt.Printf("%v %v\n", nil, a)

	xs := []any{1, "a", 2.5}
	fmt.Println(fmt.Sprintf("%d %s %.1f", xs...))
	fmt.Println(xs...)
	fmt.Print(xs...)
	fmt.Println()
	fmt.Println(fmt.Sprint(xs...), fmt.Sprintln(xs...) == "1 a 2.5\n")
	args := []any{"x", 4}
	fmt.Printf("%s=%d\n", args...)
	fmt.Println("pre", xs)

	var e error = errors.New("err")
	var ea any = e
	fmt.Println(ea, e)
	var s fmt.Stringer = Color(0)
	fmt.Println(s)
}
