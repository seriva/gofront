package main

import (
	"bytes"
	"fmt"
	"unicode"
)

func show(parts [][]byte) {
	line := fmt.Sprintf("%d [", len(parts))
	for i, p := range parts {
		if i > 0 {
			line += "|"
		}
		line += fmt.Sprint(p)
	}
	fmt.Println(line+"]", parts == nil)
}

func main() {
	s := []byte("a,b,c,d")
	sep := []byte(",")
	show(bytes.SplitAfter(s, sep))
	for _, n := range []int{-1, 0, 1, 2, 3, 4, 5, 10} {
		show(bytes.SplitAfterN(s, sep, n))
	}
	show(bytes.SplitAfter([]byte("abc"), nil))
	show(bytes.SplitAfter([]byte("héj"), []byte{}))
	for _, n := range []int{-1, 0, 1, 2, 3, 4, 10} {
		show(bytes.SplitAfterN([]byte("héj"), nil, n))
	}
	show(bytes.SplitAfter([]byte{0xff, 'a', 0xe2, 0x82}, nil))
	show(bytes.SplitAfter(nil, sep))
	show(bytes.SplitAfter(nil, nil))
	show(bytes.SplitAfter([]byte("xx,yy,"), sep))
	show(bytes.SplitAfter([]byte("a--b----c"), []byte("--")))

	part := bytes.SplitAfterN(s, sep, 2)[0]
	fmt.Println(len(part), cap(part))

	fmt.Println(bytes.Runes([]byte("héllo, 世界")))
	fmt.Println(bytes.Runes([]byte{'a', 0xff, 'b'}), len(bytes.Runes(nil)))

	fmt.Println(bytes.Title([]byte("hello wörld, ñandú_x 3d a-b")))
	fmt.Println(bytes.Title([]byte("")))
	fmt.Println(bytes.Title([]byte{'a', 0xff, 'b'}))

	isSpace := func(r rune) bool { return unicode.IsSpace(r) }
	isDigit := func(r rune) bool { return unicode.IsDigit(r) }
	fmt.Println(bytes.TrimLeftFunc([]byte("  \t hi  "), isSpace))
	fmt.Println(bytes.TrimRightFunc([]byte("  \t hi  \n"), isSpace))
	fmt.Println(bytes.TrimLeftFunc([]byte("123abc456"), isDigit))
	fmt.Println(bytes.TrimRightFunc([]byte("123abc456"), isDigit))
	fmt.Println(bytes.TrimRightFunc([]byte("héllo世"), func(r rune) bool { return r == '世' || r == 'o' }))
	r := bytes.TrimLeftFunc([]byte("   "), isSpace)
	fmt.Println(r == nil, len(r))
	r = bytes.TrimRightFunc([]byte("   "), isSpace)
	fmt.Println(r == nil, len(r))
	fmt.Println(len(bytes.TrimRightFunc(nil, isSpace)))

	fmt.Println(bytes.MinRead, bytes.ErrTooLarge)
}
