package main

import (
	"fmt"
	"unicode/utf16"
)

func main() {
	runes := []rune{'a', 'Z', 0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xe000, 0xffff, 0x10000, 0x1f44b, 0x10ffff}
	for _, r := range runes {
		r1, r2 := utf16.EncodeRune(r)
		fmt.Printf("%U len=%d surr=%v enc=%x,%x dec=%U\n", r, utf16.RuneLen(r), utf16.IsSurrogate(r), r1, r2, utf16.DecodeRune(r1, r2))
	}
	// Invalid input.
	for _, r := range []rune{-1, 0xd800, 0xdfff, 0x110000} {
		r1, r2 := utf16.EncodeRune(r)
		fmt.Printf("%d len=%d surr=%v enc=%x,%x\n", r, utf16.RuneLen(r), utf16.IsSurrogate(r), r1, r2)
	}
	fmt.Printf("%U %U %U\n", utf16.DecodeRune(0xd800, 0x0041), utf16.DecodeRune(0xdc00, 0xdc00), utf16.DecodeRune(0x41, 0xdc00))

	s := []rune("aé世\U0001f44b\U00010000z")
	u := utf16.Encode(s)
	fmt.Printf("%x\n", u)
	back := utf16.Decode(u)
	fmt.Printf("%U\n", back)

	// Unpaired surrogates decode to U+FFFD.
	fmt.Printf("%U\n", utf16.Decode([]uint16{0xd800, 0x41, 0xdc00, 0xd83d, 0xdc4b, 0xd83d}))
	fmt.Printf("%U\n", utf16.Decode(nil))
	fmt.Printf("%x\n", utf16.Encode([]rune{0xd800, 0x110000, 0x41}))

	var a []uint16
	a = utf16.AppendRune(a, 'x')
	a = utf16.AppendRune(a, 0x1f44b)
	a = utf16.AppendRune(a, 0xd800)
	a = utf16.AppendRune(a, 0x110000)
	fmt.Printf("%x\n", a)
}
