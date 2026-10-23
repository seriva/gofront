package main

import "fmt"

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
}
