package main

import (
	"bytes"
	"fmt"
	"slices"
	"strings"
	"unicode"
)

// show prints each element of a sequence of byte slices as a quoted string.
func show(label string, parts [][]byte) {
	out := make([]string, len(parts))
	for i, p := range parts {
		out[i] = string(p)
	}
	fmt.Println(label, "["+strings.Join(out, "|")+"]")
}

// vis makes newlines visible: the fmt %q verb does not escape them yet.
func vis(b []byte) string { return "<" + strings.ReplaceAll(string(b), "\n", "\\n") + ">" }

func isDigit(r rune) bool { return unicode.IsDigit(r) }

func main() {
	// Lines keeps the terminators; no line for an empty slice.
	for l := range bytes.Lines([]byte("one\ntwo\n\nthree")) {
		fmt.Println("line", vis(l))
	}
	fmt.Println(len(slices.Collect(bytes.Lines(nil))), len(slices.Collect(bytes.Lines([]byte("\n")))))

	// SplitSeq / SplitAfterSeq
	show("split", slices.Collect(bytes.SplitSeq([]byte("a,b,,c"), []byte(","))))
	show("after", slices.Collect(bytes.SplitAfterSeq([]byte("a,b,,c"), []byte(","))))
	show("multi", slices.Collect(bytes.SplitSeq([]byte("a--b--c"), []byte("--"))))
	show("empty", slices.Collect(bytes.SplitSeq([]byte(""), []byte(","))))
	show("explode", slices.Collect(bytes.SplitSeq([]byte("abc"), nil)))
	show("explode after", slices.Collect(bytes.SplitAfterSeq([]byte("abc"), []byte(""))))
	show("trailing", slices.Collect(bytes.SplitSeq([]byte("trailing,"), []byte(","))))
	show("runes", slices.Collect(bytes.SplitSeq([]byte("日本語"), nil)))
	show("utf8 sep", slices.Collect(bytes.SplitSeq([]byte("héllo wörld"), []byte("ö"))))

	// An invalid or truncated encoding is one byte wide.
	for p := range bytes.SplitSeq([]byte{0xff, 'a', 0xc3, 0xa9, 0xe2, 0x82, 0xed, 0xa0, 0x80}, nil) {
		fmt.Print(len(p), " ")
	}
	fmt.Println()

	// FieldsSeq / FieldsFuncSeq
	show("fields", slices.Collect(bytes.FieldsSeq([]byte("  foo bar\t baz\n"))))
	fmt.Println(len(slices.Collect(bytes.FieldsSeq([]byte("   ")))), len(slices.Collect(bytes.FieldsSeq(nil))))
	show("unicode space", slices.Collect(bytes.FieldsSeq([]byte("α β γ"))))
	show("func", slices.Collect(bytes.FieldsFuncSeq([]byte("  foo1bar2  baz  "), isDigit)))
	isSep := func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }
	show("func sep", slices.Collect(bytes.FieldsFuncSeq([]byte("a1,b2;; c3"), isSep)))

	// The sequences give what the slice functions return.
	s := []byte("x=1;y=2;;z=3")
	same := func(a, b [][]byte) bool {
		if len(a) != len(b) {
			return false
		}
		for i := range a {
			if !bytes.Equal(a[i], b[i]) {
				return false
			}
		}
		return true
	}
	fmt.Println(same(slices.Collect(bytes.SplitSeq(s, []byte(";"))), bytes.Split(s, []byte(";"))))
	fmt.Println(same(slices.Collect(bytes.FieldsSeq([]byte(" a b  c "))), bytes.Fields([]byte(" a b  c "))))

	// The yielded slices alias the input and have their capacity clipped, so
	// appending to one leaves the input intact.
	data := []byte("ab,cd,ef")
	for part := range bytes.SplitSeq(data, []byte(",")) {
		part = append(part, 'X')
		_ = part
	}
	fmt.Println(string(data))
	for line := range bytes.Lines([]byte("p\nq\n")) {
		fmt.Println(len(line), cap(line))
	}
	for f := range bytes.FieldsSeq(data) {
		fmt.Println(len(f), cap(f))
	}

	// Early break stops the iteration.
	n := 0
	for part := range bytes.SplitSeq([]byte("a b c d e"), []byte(" ")) {
		n++
		if string(part) == "c" {
			break
		}
	}
	fmt.Println("visited", n)
	for l := range bytes.Lines([]byte("x\ny\n")) {
		fmt.Println("first line", vis(l))
		break
	}
}
