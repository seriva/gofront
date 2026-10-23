package main

import (
	"fmt"
	"slices"
	"strings"
	"unicode"
)

// vis makes newlines visible: the fmt %q verb does not escape them yet.
func vis(s string) string { return "<" + strings.ReplaceAll(s, "\n", "\\n") + ">" }

// list shows parts between brackets, separated by "|": the fmt %q verb on a
// []string does not quote element by element yet.
func list(parts []string) string { return "[" + strings.Join(parts, "|") + "]" }

func isDigit(r rune) bool { return unicode.IsDigit(r) }

func main() {
	// Lines keeps the terminators; no line for an empty string.
	for l := range strings.Lines("one\ntwo\n\nthree") {
		fmt.Println("line", vis(l))
	}
	fmt.Println(len(slices.Collect(strings.Lines(""))))
	fmt.Println(len(slices.Collect(strings.Lines("\n"))), len(slices.Collect(strings.Lines("a\r\nb\n"))))

	// SplitSeq / SplitAfterSeq
	fmt.Println(list(slices.Collect(strings.SplitSeq("a,b,,c", ","))))
	fmt.Println(list(slices.Collect(strings.SplitAfterSeq("a,b,,c", ","))))
	fmt.Println(list(slices.Collect(strings.SplitSeq("a--b--c", "--"))))
	fmt.Println(list(slices.Collect(strings.SplitSeq("", ","))))
	fmt.Println(list(slices.Collect(strings.SplitSeq("abc", ""))))
	fmt.Println(list(slices.Collect(strings.SplitAfterSeq("abc", ""))))
	fmt.Println(list(slices.Collect(strings.SplitSeq("trailing,", ","))))
	fmt.Println(list(slices.Collect(strings.SplitSeq("no separator", ","))))
	fmt.Println(slices.Collect(strings.SplitSeq("héllo wörld", "ö")))
	fmt.Println(slices.Collect(strings.SplitSeq("日本語", "")))

	// FieldsSeq / FieldsFuncSeq
	fmt.Println(list(slices.Collect(strings.FieldsSeq("  foo bar\t baz\n"))))
	fmt.Println(len(slices.Collect(strings.FieldsSeq("   "))), len(slices.Collect(strings.FieldsSeq(""))))
	fmt.Println(slices.Collect(strings.FieldsSeq("α β γ")))
	isSep := func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }
	fmt.Println(list(slices.Collect(strings.FieldsFuncSeq("  foo1bar2  baz  ", isDigit))))
	fmt.Println(list(slices.Collect(strings.FieldsFuncSeq("a1,b2;; c3", isSep))))
	fmt.Println(len(slices.Collect(strings.FieldsFuncSeq("", isSep))))

	// The sequences give what the slice functions return.
	s := "x=1;y=2;;z=3"
	fmt.Println(slices.Equal(slices.Collect(strings.SplitSeq(s, ";")), strings.Split(s, ";")))
	fmt.Println(slices.Equal(slices.Collect(strings.SplitAfterSeq(s, ";")), strings.SplitAfter(s, ";")))
	fmt.Println(slices.Equal(slices.Collect(strings.FieldsSeq(" a b  c ")), strings.Fields(" a b  c ")))

	// Early break stops the iteration.
	n := 0
	for part := range strings.SplitSeq("a b c d e", " ") {
		n++
		if part == "c" {
			break
		}
	}
	fmt.Println("visited", n)
	for f := range strings.FieldsSeq("first second third") {
		fmt.Println("first field", f)
		break
	}
	for l := range strings.Lines("x\ny\n") {
		fmt.Println("first line", vis(l))
		break
	}
}
