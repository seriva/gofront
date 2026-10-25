package main

import (
	"fmt"
	"io"
	"strings"
)

func main() {
	// Test Fscanln
	r1 := strings.NewReader("123 hello\n456 world\n")
	var a int
	var b string
	n1, err1 := fmt.Fscanln(r1, &a, &b)
	fmt.Println("Fscanln 1:", n1, err1 == nil, a, b)

	var c int
	var d string
	n2, err2 := fmt.Fscanln(r1, &c, &d)
	fmt.Println("Fscanln 2:", n2, err2 == nil, c, d)

	var e int
	n3, err3 := fmt.Fscanln(r1, &e)
	fmt.Println("Fscanln EOF:", n3, err3 == io.EOF)

	// Test Fscan across whitespace and newlines
	r2 := strings.NewReader("10 20\n30   40\n")
	var x1, x2, x3, x4 int
	nx1, errx1 := fmt.Fscan(r2, &x1, &x2)
	fmt.Println("Fscan 1:", nx1, errx1 == nil, x1, x2)
	nx2, errx2 := fmt.Fscan(r2, &x3, &x4)
	fmt.Println("Fscan 2:", nx2, errx2 == nil, x3, x4)

	var x5 int
	nx3, errx3 := fmt.Fscan(r2, &x5)
	fmt.Println("Fscan EOF:", nx3, errx3 == io.EOF)

	// Test Fscanf
	r3 := strings.NewReader("id: 42 name: foo\nid: 99 name: bar\n")
	var id1, id2 int
	var name1, name2 string
	nf1, errf1 := fmt.Fscanf(r3, "id: %d name: %s\n", &id1, &name1)
	fmt.Println("Fscanf 1:", nf1, errf1 == nil, id1, name1)
	nf2, errf2 := fmt.Fscanf(r3, "id: %d name: %s\n", &id2, &name2)
	fmt.Println("Fscanf 2:", nf2, errf2 == nil, id2, name2)
}
