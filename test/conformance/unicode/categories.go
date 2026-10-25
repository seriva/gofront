package main

import (
	"bytes"
	"fmt"
	"strings"
	"unicode"
)

var testRunes = []rune{'a', 'Z', '5', ' ', '\t', '\n', '\u0085', '\u00a0', '\u2000', '\ufeff', '.', '$', '+', '\u0300', '1', 'Ⅸ'}

func testCategories() {
	fmt.Print("IsLetter:")
	for _, r := range testRunes {
		fmt.Printf(" %c:%v", r, unicode.Is(unicode.Letter, r))
	}
	fmt.Println()

	fmt.Print("IsDigit:")
	for _, r := range testRunes {
		fmt.Printf(" %c:%v", r, unicode.Is(unicode.Digit, r))
	}
	fmt.Println()

	fmt.Print("IsSpace table:")
	for _, r := range testRunes {
		fmt.Printf(" %U:%v", r, unicode.Is(unicode.Space, r))
	}
	fmt.Println()

	fmt.Print("IsUpper table:")
	for _, r := range testRunes {
		fmt.Printf(" %c:%v", r, unicode.Is(unicode.Upper, r))
	}
	fmt.Println()

	fmt.Print("IsLower table:")
	for _, r := range testRunes {
		fmt.Printf(" %c:%v", r, unicode.Is(unicode.Lower, r))
	}
	fmt.Println()

	fmt.Print("IsPunct:")
	for _, r := range testRunes {
		fmt.Printf(" %c:%v", r, unicode.Is(unicode.Punct, r))
	}
	fmt.Println()

	fmt.Print("IsSymbol:")
	for _, r := range testRunes {
		fmt.Printf(" %c:%v", r, unicode.Is(unicode.Symbol, r))
	}
	fmt.Println()

	fmt.Print("IsMark:")
	for _, r := range testRunes {
		fmt.Printf(" %U:%v", r, unicode.Is(unicode.Mark, r))
	}
	fmt.Println()

	fmt.Print("IsNumber:")
	for _, r := range testRunes {
		fmt.Printf(" %c:%v", r, unicode.Is(unicode.Number, r))
	}
	fmt.Println()
}

func testHelpers() {
	fmt.Print("IsNumber helper:")
	for _, r := range testRunes {
		fmt.Printf(" %c:%v", r, unicode.IsNumber(r))
	}
	fmt.Println()

	fmt.Print("IsSymbol helper:")
	for _, r := range testRunes {
		fmt.Printf(" %c:%v", r, unicode.IsSymbol(r))
	}
	fmt.Println()

	fmt.Print("IsMark helper:")
	for _, r := range testRunes {
		fmt.Printf(" %U:%v", r, unicode.IsMark(r))
	}
	fmt.Println()

	titleRunes := []rune{'a', 'A', 0x1C5, 0x1C8, 0x1CB, 0x1F2, 0x1F88, 0x1FBC}
	fmt.Print("IsTitle:")
	for _, r := range titleRunes {
		fmt.Printf(" %U:%v", r, unicode.IsTitle(r))
	}
	fmt.Println()

	fmt.Printf("In 'a' (Letter, Digit): %v\n", unicode.In('a', unicode.Letter, unicode.Digit))
	fmt.Printf("In '5' (Letter, Digit): %v\n", unicode.In('5', unicode.Letter, unicode.Digit))
	fmt.Printf("In '$' (Letter, Digit): %v\n", unicode.In('$', unicode.Letter, unicode.Digit))
	ranges := []*unicode.RangeTable{unicode.Letter, unicode.Digit}
	fmt.Printf("IsOneOf 'a': %v\n", unicode.IsOneOf(ranges, 'a'))
	fmt.Printf("IsOneOf '$': %v\n", unicode.IsOneOf(ranges, '$'))
}

func testCaseFold() {
	foldRunes := []rune{'A', 'a', 'K', 'k', 0x212A, '1', 's', 'S', 0x017F}
	fmt.Print("SimpleFold:")
	for _, r := range foldRunes {
		fmt.Printf(" %U->%U", r, unicode.SimpleFold(r))
	}
	fmt.Println()
	fmt.Printf("SimpleFold(-2): %d\n", unicode.SimpleFold(-2))

	for _, r := range []rune{'a', 'Z', 0x1C4, 0x1C5, 0x1C6, 0x10D0} {
		fmt.Printf("%U: ToUpper=%U ToLower=%U ToTitle=%U ToTitle=%U\n",
			r,
			unicode.To(unicode.UpperCase, r),
			unicode.To(unicode.LowerCase, r),
			unicode.To(unicode.TitleCase, r),
			unicode.ToTitle(r),
		)
	}
}

func testWhitespaceFields() {
	spaceRunes := []rune{'\t', '\n', '\v', '\f', '\r', ' ', 0x85, 0xA0, 0x1680, 0x2000, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF, 'x'}
	fmt.Print("unicode.IsSpace:")
	for _, r := range spaceRunes {
		fmt.Printf(" %U:%v", r, unicode.IsSpace(r))
	}
	fmt.Println()

	p16Str := "a\u0085b\vc\u00a0d\ufeffe"
	fmt.Printf("strings.Fields: %#v\n", strings.Fields(p16Str))
	byFields := bytes.Fields([]byte(p16Str))
	fmt.Print("bytes.Fields:")
	for _, b := range byFields {
		fmt.Printf(" %q", string(b))
	}
	fmt.Println()

	fmt.Print("strings.FieldsSeq:")
	for w := range strings.FieldsSeq(p16Str) {
		fmt.Printf(" %q", w)
	}
	fmt.Println()

	fmt.Print("bytes.FieldsSeq:")
	for w := range bytes.FieldsSeq([]byte(p16Str)) {
		fmt.Printf(" %q", string(w))
	}
	fmt.Println()
}

func main() {
	testCategories()
	testHelpers()
	testCaseFold()
	testWhitespaceFields()
}
