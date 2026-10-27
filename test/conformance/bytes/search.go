package main

import (
	"bytes"
	"fmt"
	"unicode"
	"unicode/utf8"
)

func b(s string) []byte { return []byte(s) }

func main() {
	fmt.Println(bytes.Compare(b("a"), b("b")), bytes.Compare(b("b"), b("a")), bytes.Compare(b("abc"), b("abc")))
	fmt.Println(bytes.Compare(b("ab"), b("abc")), bytes.Compare(b("abc"), b("ab")), bytes.Compare(nil, []byte{}))
	fmt.Println(bytes.Compare([]byte{0xff}, []byte{0x7f}))

	fmt.Println(bytes.EqualFold(b("Go"), b("GO")), bytes.EqualFold(b("Go"), b("Gx")), bytes.EqualFold(b("Straße"), b("STRASSE")))
	fmt.Println(bytes.EqualFold(b("Σ"), b("ς")), bytes.EqualFold(b("K"), b("K")), bytes.EqualFold(b("é"), b("É")))
	fmt.Println(bytes.EqualFold([]byte{0xff}, []byte{0xff}), bytes.EqualFold([]byte{0xff}, b("�")), bytes.EqualFold(b("a"), b("ab")))

	h := b("héllo, wörld")
	fmt.Println(bytes.IndexRune(h, 'l'), bytes.IndexRune(h, 'ö'), bytes.IndexRune(h, 'z'), bytes.IndexRune(h, 0xD800), bytes.IndexRune(h, -1))
	inv := []byte{'a', 0xff, 'b', 0xe2, 0x82}
	fmt.Println(bytes.IndexRune(inv, utf8.RuneError), bytes.IndexRune(b("ab"), utf8.RuneError), bytes.IndexRune(b("a�b"), utf8.RuneError))

	fmt.Println(bytes.IndexAny(h, "ö,"), bytes.IndexAny(h, "xyz"), bytes.IndexAny(h, ""), bytes.IndexAny(nil, "a"))
	fmt.Println(bytes.IndexAny(inv, "�"), bytes.IndexAny(inv, "b"), bytes.IndexAny(b("日本語"), "語本"))
	fmt.Println(bytes.LastIndexAny(h, "lo"), bytes.LastIndexAny(h, "é"), bytes.LastIndexAny(h, "xyz"), bytes.LastIndexAny(h, ""))
	fmt.Println(bytes.LastIndexAny(inv, "�"), bytes.LastIndexAny(inv, "a"), bytes.LastIndexAny(b("日本語"), "日本"))

	isUpper := func(r rune) bool { return unicode.IsUpper(r) }
	isRuneErr := func(r rune) bool { return r == utf8.RuneError }
	w := b("abÇdÉf")
	fmt.Println(bytes.IndexFunc(w, isUpper), bytes.LastIndexFunc(w, isUpper), bytes.IndexFunc(b("abc"), isUpper), bytes.LastIndexFunc(nil, isUpper))
	fmt.Println(bytes.IndexFunc(inv, isRuneErr), bytes.LastIndexFunc(inv, isRuneErr))
	fmt.Println(bytes.ContainsFunc(w, isUpper), bytes.ContainsFunc(b("abc"), isUpper), bytes.ContainsFunc(inv, isRuneErr))

	rest, ok := bytes.CutPrefix(b("foobar"), b("foo"))
	fmt.Println(string(rest), ok)
	rest, ok = bytes.CutPrefix(b("foobar"), b("bar"))
	fmt.Println(string(rest), ok)
	rest, ok = bytes.CutPrefix(b("foo"), nil)
	fmt.Println(string(rest), ok)
	rest, ok = bytes.CutPrefix(b("fo"), b("foo"))
	fmt.Println(string(rest), ok)
	rest, ok = bytes.CutSuffix(b("foobar"), b("bar"))
	fmt.Println(string(rest), ok)
	rest, ok = bytes.CutSuffix(b("foobar"), b("foo"))
	fmt.Println(string(rest), ok)
	rest, ok = bytes.CutSuffix(b("foo"), nil)
	fmt.Println(string(rest), ok)
	rest, ok = bytes.CutSuffix(b("oo"), b("foo"))
	fmt.Println(string(rest), ok)
}
