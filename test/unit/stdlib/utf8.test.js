// GoFront test suite — unicode/utf8 (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import {
	assertAllTargetsOutput,
	assertFourWay,
	section,
	test,
} from "../helpers.js";

section("unicode/utf8 (Go-source)");

test("decoding, encoding, counting and validity", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"unicode/utf8"
)

func main() {
	fmt.Println(utf8.RuneError, utf8.MaxRune, utf8.UTFMax, utf8.RuneSelf)
	s := "héllo, 世界 😀"
	fmt.Println(len([]byte(s)), utf8.RuneCountInString(s), utf8.RuneCount([]byte(s)), utf8.ValidString(s))
	for _, in := range []string{"", "a", "é", "世", "😀"} {
		r, n := utf8.DecodeRuneInString(in)
		lr, ln := utf8.DecodeLastRuneInString(in)
		fmt.Println(fmt.Sprintf("%q", in), r, n == len(in), lr, ln == len(in), utf8.FullRuneInString(in), utf8.ValidString(in), utf8.RuneCountInString(in))
	}
	for _, in := range [][]byte{nil, []byte("a"), []byte("é"), []byte("世"), []byte("😀"), {0xff}, {0xc3}, {0xe4, 0xb8}, {0xed, 0xa0, 0x80}, {0xf4, 0x90, 0x80, 0x80}, {0xc0, 0x80}, {'a', 0xff, 'b'}, {0xe4, 0xb8, 0x96, 0xe7}} {
		br, bn := utf8.DecodeRune(in)
		blr, bln := utf8.DecodeLastRune(in)
		fmt.Println(in, br, bn, blr, bln, utf8.FullRune(in), utf8.Valid(in), utf8.RuneCount(in))
	}
	for _, r := range []rune{-1, 0, 'a', 0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xd800, 0xdfff, 0xe000, 0xffff, 0x10000, 0x10ffff, 0x110000} {
		buf := make([]byte, 4)
		n := utf8.EncodeRune(buf, r)
		fmt.Println(r, utf8.RuneLen(r), utf8.ValidRune(r), n, buf[:n], utf8.AppendRune([]byte("x"), r))
	}
	fmt.Println(utf8.RuneStart('a'), utf8.RuneStart(0x80), utf8.RuneStart(0xc3))
	b := []byte("abc世界")
	for len(b) > 0 {
		r, size := utf8.DecodeLastRune(b)
		fmt.Print(r, ":", size, " ")
		b = b[:len(b)-size]
	}
	fmt.Println()
}
`,
		`65533 1114111 4 128
19 11 11 true
"" 65533 true 65533 true false true 0
"a" 97 true 97 true true true 1
"é" 233 true 233 true true true 1
"世" 19990 true 19990 true true true 1
"😀" 128512 true 128512 true true true 1
[] 65533 0 65533 0 false true 0
[97] 97 1 97 1 true true 1
[195 169] 233 2 233 2 true true 1
[228 184 150] 19990 3 19990 3 true true 1
[240 159 152 128] 128512 4 128512 4 true true 1
[255] 65533 1 65533 1 true false 1
[195] 65533 1 65533 1 false false 1
[228 184] 65533 1 65533 1 false false 2
[237 160 128] 65533 1 65533 1 true false 3
[244 144 128 128] 65533 1 65533 1 true false 4
[192 128] 65533 1 65533 1 true false 2
[97 255 98] 97 1 98 1 true false 3
[228 184 150 231] 19990 3 65533 1 true false 2
-1 -1 false 3 [239 191 189] [120 239 191 189]
0 1 true 1 [0] [120 0]
97 1 true 1 [97] [120 97]
127 1 true 1 [127] [120 127]
128 2 true 2 [194 128] [120 194 128]
2047 2 true 2 [223 191] [120 223 191]
2048 3 true 3 [224 160 128] [120 224 160 128]
55295 3 true 3 [237 159 191] [120 237 159 191]
55296 -1 false 3 [239 191 189] [120 239 191 189]
57343 -1 false 3 [239 191 189] [120 239 191 189]
57344 3 true 3 [238 128 128] [120 238 128 128]
65535 3 true 3 [239 191 191] [120 239 191 191]
65536 4 true 4 [240 144 128 128] [120 240 144 128 128]
1114111 4 true 4 [244 143 191 191] [120 244 143 191 191]
1114112 -1 false 3 [239 191 189] [120 239 191 189]
true false true
30028:3 19990:3 99:1 98:1 97:1 
`,
	);
});

test("string(rune) of an invalid rune is U+FFFD", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	x := rune(-1)
	y := rune(0x110000)
	z := rune(0xD800)
	fmt.Println(string(x) == "\\ufffd", string(y) == "\\ufffd", string(z) == "\\ufffd")
	fmt.Println(string(rune(0x1F600)) == "\\U0001F600", string(rune('a')))
	fmt.Println(len([]byte(string(x))), len([]byte(string(z))))
}
`,
		`true true true
true a
3 3
`,
	);
});
