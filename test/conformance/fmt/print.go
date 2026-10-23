package main

import (
	"errors"
	"fmt"
)

type name string

func main() {
	// Print adds a space only between two operands when neither is a string.
	fmt.Print("a", "b", 1, 2, "c")
	fmt.Println()
	fmt.Print(1, 2, 3)
	fmt.Println()
	fmt.Print("x", 1, "y", 2.5, true, false, 'a')
	fmt.Println()
	var v any = "s"
	var n any
	fmt.Print(v, 1, v, n, n)
	fmt.Println()
	fmt.Print(name("p"), name("q"), 7)
	fmt.Println()

	// Sprint follows the same rule, Sprintln always separates.
	fmt.Println(fmt.Sprint("a", 1, 2, "b", 3.5, true, false) + "|")
	fmt.Println(fmt.Sprint() + "|")
	fmt.Println(fmt.Sprint("only") + "|")
	fmt.Print(fmt.Sprintln("a", 1, "b", 2, 3))
	fmt.Print(fmt.Sprintln())
	fmt.Println(len(fmt.Sprintln()))

	// Append* write into a []byte.
	b := []byte("x=")
	b = fmt.Append(b, 1, 2, "z")
	b = fmt.Appendf(b, "|%03d|%s", 7, "w")
	b = fmt.Appendln(b, "end", 9)
	fmt.Print(string(b))
	fmt.Println(len(b))
	c := fmt.Append(nil, "n", "m")
	fmt.Println(string(c), len(c))

	// error operands are not strings: Sprint/Print/Append space them.
	e1 := errors.New("a")
	e2 := errors.New("b")
	fmt.Println(fmt.Sprint(e1, e2) + "|")
	fmt.Println(fmt.Sprint(e1, 1, "x", e2) + "|")
	fmt.Println(fmt.Sprint("s", e1, "t") + "|")
	fmt.Print(e1, e2, "z")
	fmt.Println()
	fmt.Println(string(fmt.Append(nil, e1, e2)))

	// Append reuses spare capacity of dst, like append.
	sb := make([]byte, 2, 10)
	sc := fmt.Append(sb, "xy")
	sd := fmt.Append(sb, "zw")
	fmt.Println(len(sc), cap(sc) >= 4, string(sc[2:]), string(sd[2:]))
	hs := []byte("hello")
	hs2 := fmt.Append(hs[:2], "Z")
	fmt.Println(string(hs), string(hs2))
	hs3 := fmt.Appendf(hs[:1], "%s", "J")
	hs4 := fmt.Appendln(hs[:3], "K")
	fmt.Println(string(hs), string(hs3), len(hs4))
	// A full destination reallocates and leaves the original alone.
	fb := []byte("ab")
	fb2 := fmt.Append(fb[:2:2], "cd")
	fmt.Println(string(fb), string(fb2))
}
