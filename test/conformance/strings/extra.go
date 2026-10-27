package main

import (
	"bytes"
	"fmt"
	"strings"
	"slices"
	"unicode"
)

func main() {
	fmt.Println(strings.Clone("héllo"), strings.Clone(""))
	fmt.Println(strings.Compare("a", "b"), strings.Compare("b", "a"), strings.Compare("a", "a"), strings.Compare("", "a"), strings.Compare("ab", "a"))
	isUpper := func(r rune) bool { return unicode.IsUpper(r) }
	fmt.Println(strings.ContainsFunc("abC", isUpper), strings.ContainsFunc("abc", isUpper), strings.ContainsFunc("", isUpper), strings.ContainsFunc("日本Ä", isUpper))

	r := strings.NewReplacer("a", "1", "b", "22", "<", "&lt;")
	var buf bytes.Buffer
	n, err := r.WriteString(&buf, "abc<abc")
	fmt.Println(n, err, buf.String())
	var sb strings.Builder
	n, err = r.WriteString(&sb, "")
	fmt.Println(n, err, sb.String())
	n, err = r.WriteString(&sb, "ba")
	fmt.Println(n, err, sb.String())

	cmpLen := func(a string, b int) int { return len(a) - b }
	fmt.Println(slices.CompareFunc([]string{"a", "bb"}, []int{1, 2}, cmpLen))
	fmt.Println(slices.CompareFunc([]string{"a", "bb"}, []int{1, 3}, cmpLen))
	fmt.Println(slices.CompareFunc([]string{"a", "bb"}, []int{1}, cmpLen))
	fmt.Println(slices.CompareFunc([]string{"a"}, []int{1, 2}, cmpLen))
	fmt.Println(slices.CompareFunc([]string{"a"}, []int{0}, cmpLen))
	var n1 []string
	var n2 []int
	fmt.Println(slices.CompareFunc(n1, n2, cmpLen))
	eqLen := func(a string, b int) bool { return len(a) == b }
	fmt.Println(slices.EqualFunc([]string{"a", "bb"}, []int{1, 2}, eqLen))
	fmt.Println(slices.EqualFunc([]string{"a", "bb"}, []int{1, 3}, eqLen))
	fmt.Println(slices.EqualFunc([]string{"a"}, []int{1, 2}, eqLen))

	rep := slices.Repeat([]int{1, 2, 3}, 3)
	fmt.Println(rep, len(rep), cap(rep))
	rep = slices.Repeat([]int{1, 2}, 0)
	fmt.Println(rep, len(rep), cap(rep), rep == nil)
	var nilInts []int
	rep = slices.Repeat(nilInts, 5)
	fmt.Println(rep, len(rep), rep == nil)
	src := []string{"x"}
	rs := slices.Repeat(src, 3)
	rs[0] = "y"
	fmt.Println(rs, src)
}
