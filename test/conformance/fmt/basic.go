package main

import "fmt"

type point struct {
	X, Y int
}

func main() {
	fmt.Println("hello", 42, true, 2.5)
	fmt.Printf("%d|%5d|%-5d|%05d\n", 7, 7, 7, 7)
	fmt.Printf("%s|%q|%v\n", "go", "go", "go")
	fmt.Printf("%x|%X|%o|%b\n", 255, 255, 8, 5)
	fmt.Printf("%.2f|%8.3f|%.1f\n", 3.14159, 2.5, 1234.5678)
	fmt.Printf("%t|%c\n", false, 'A')
	fmt.Printf("%v|%+v\n", point{1, 2}, point{1, 2})
	fmt.Printf("%v|%v\n", []int{1, 2, 3}, []string{"a", "b"})
	fmt.Printf("%%|%v%%\n", 50)
	s := fmt.Sprintf("%03d-%s", 9, "x")
	fmt.Println(s, len(s))
	fmt.Print("no newline yet, ")
	fmt.Print("then one")
	fmt.Println()
	fmt.Println(fmt.Sprintf("%v|%6.2f|%-6s|", true, -1.5, "ab"))
}
